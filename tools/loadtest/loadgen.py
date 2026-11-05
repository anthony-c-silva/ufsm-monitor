#!/usr/bin/env python3
"""Gerador de carga do SONDAR: simula N sondas publicando resultados no RabbitMQ.

Cada sonda simulada segue o mesmo perfil de planos usado nas sondas reais
(PERFIL abaixo) e publica envelopes no mesmo formato do agente, na exchange
monitor.results com routing key result.<tipo>. As sondas simuladas usam
probe_id "sim-0001", "sim-0002", ... e plan_id "loadtest", o que permite
removê-las depois com cleanup.sql.

Modos
  degraus   aumenta o número de sondas em degraus (ex.: 10,50,100,250,500,1000),
            mantendo cada degrau por --duracao-degrau segundos
  maximo    publica o mais rápido possível por --duracao segundos, para medir
            a vazão máxima de ingestão

Exemplos
  python loadgen.py --amqp amqp://USUARIO:SENHA@192.168.253.17:5672/ degraus
  python loadgen.py --amqp ... degraus --degraus 10,100,1000 --duracao-degrau 300
  python loadgen.py --amqp ... maximo --duracao 120

A URL também pode vir da variável de ambiente AMQP_URL.
"""
import argparse
import csv
import heapq
import json
import os
import random
import sys
import time
import uuid
from datetime import datetime, timezone

import pika

# (tipo, quantidade de destinos, período em segundos)
PERFIL = [
    ("icmp", 4, 60),
    ("dns", 2, 300),
    ("http", 3, 300),
    ("traceroute", 2, 900),
]

EXCHANGE = "monitor.results"


def msgs_por_sonda_por_s():
    return sum(n / p for _, n, p in PERFIL)


def agora_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def resultado(kind, alvo):
    r = random.random
    if kind == "icmp":
        base = random.uniform(0.5, 8.0)
        perdidos = 0 if r() > 0.05 else random.randint(1, 3)
        return {
            "samples_sent": 10, "samples_received": 10 - perdidos,
            "loss_pct": perdidos * 10.0,
            "rtt_min_ms": round(base * 0.8, 3), "rtt_avg_ms": round(base, 3),
            "rtt_max_ms": round(base * 1.9, 3), "jitter_ms": round(base * 0.2, 3),
            "rtt_p50_ms": round(base, 3), "rtt_p95_ms": round(base * 1.6, 3),
            "rtt_p99_ms": round(base * 1.8, 3),
        }
    if kind == "dns":
        return {
            "resolver": "10.99.0.53", "qname": alvo, "qtype": "A", "transport": "udp",
            "rcode": "NOERROR", "answer_count": 2,
            "elapsed_ms": round(random.uniform(1, 40), 2), "response_bytes": 96,
            "answers": ["10.99.1.10", "10.99.1.11"], "status": "success",
        }
    if kind == "http":
        dns, tcp, tls, srv = (random.uniform(1, 30), random.uniform(0.5, 10),
                              random.uniform(5, 40), random.uniform(10, 200))
        return {
            "url": alvo, "http_status": 200,
            "dns_ms": round(dns, 2), "tcp_connect_ms": round(tcp, 2),
            "tls_handshake_ms": round(tls, 2), "ttfb_ms": round(dns + tcp + tls + srv, 2),
            "total_ms": round(dns + tcp + tls + srv + random.uniform(1, 20), 2),
            "response_bytes": random.randint(500, 50000), "status": "success",
        }
    hops = [{"ttl": t, "address": f"10.99.{t}.1",
             "rtt_avg_ms": round(t * random.uniform(0.3, 1.5), 2), "loss_pct": 0}
            for t in range(1, random.randint(4, 9))]
    return {"target": alvo, "hops": hops}


def alvo_de(kind, j):
    if kind == "icmp":
        return f"10.99.0.{j + 1}"
    if kind == "dns":
        return f"servico{j + 1}.sim.local"
    if kind == "http":
        return f"https://servico{j + 1}.sim.local/"
    return f"10.99.200.{j + 1}"


def envelope(probe_id, kind, alvo):
    ts = agora_iso()
    return {
        "schema_version": "1.0", "run_id": str(uuid.uuid4()), "probe_id": probe_id,
        "kind": kind, "target": alvo, "plan_id": "loadtest",
        "observed_at": ts, "started_at": ts, "finished_at": ts,
        "status": "success", "result": resultado(kind, alvo),
    }


class Publicador:
    def __init__(self, url, confirmar):
        self.conn = pika.BlockingConnection(pika.URLParameters(url))
        self.ch = self.conn.channel()
        self.ch.exchange_declare(EXCHANGE, "topic", durable=True)
        if confirmar:
            self.ch.confirm_delivery()
        self.props = pika.BasicProperties(content_type="application/json", delivery_mode=2)

    def enviar(self, env):
        self.ch.basic_publish(EXCHANGE, f"result.{env['kind']}",
                              json.dumps(env).encode(), self.props)

    def fechar(self):
        try:
            self.conn.close()
        except Exception:  # noqa: BLE001
            pass


def adicionar_sondas(fila, inicio, fim, t0):
    """Agenda as tarefas das sondas [inicio, fim) com deslocamento aleatório no período."""
    for i in range(inicio, fim):
        pid = f"sim-{i + 1:04d}"
        for kind, n, periodo in PERFIL:
            for j in range(n):
                heapq.heappush(fila, (t0 + random.uniform(0, periodo), pid, kind, j, periodo))


def modo_degraus(args, pub, log):
    degraus = [int(x) for x in args.degraus.split(",")]
    fila, ativas = [], 0
    total = 0
    for passo, n in enumerate(degraus, 1):
        t_ini = time.time()
        adicionar_sondas(fila, ativas, n, t_ini)
        ativas = n
        oferta = n * msgs_por_sonda_por_s()
        print(f"degrau {passo}: {n} sondas, carga esperada {oferta:.1f} msg/s "
              f"por {args.duracao_degrau}s", flush=True)
        prox_log = t_ini + 1
        while time.time() < t_ini + args.duracao_degrau:
            agora = time.time()
            if fila and fila[0][0] <= agora:
                t, pid, kind, j, periodo = heapq.heappop(fila)
                pub.enviar(envelope(pid, kind, alvo_de(kind, j)))
                total += 1
                heapq.heappush(fila, (t + periodo, pid, kind, j, periodo))
            else:
                espera = min(prox_log, fila[0][0] if fila else prox_log) - agora
                if espera > 0:
                    pub.conn.sleep(min(espera, 0.05))
            if time.time() >= prox_log:
                log.writerow([agora_iso(), passo, n, round(oferta, 2), total])
                prox_log += 1


def modo_maximo(args, pub, log):
    fim = time.time() + args.duracao
    total, prox_log = 0, time.time() + 1
    kinds = [k for k, n, p in PERFIL for _ in range(max(1, round(n * 900 / p)))]
    print(f"modo máximo por {args.duracao}s", flush=True)
    while time.time() < fim:
        kind = random.choice(kinds)
        pid = f"sim-{random.randint(1, args.sondas):04d}"
        pub.enviar(envelope(pid, kind, alvo_de(kind, random.randint(0, 2))))
        total += 1
        if time.time() >= prox_log:
            log.writerow([agora_iso(), 0, args.sondas, "max", total])
            prox_log += 1
    print(f"publicadas {total} mensagens ({total / args.duracao:.0f} msg/s)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--amqp", default=os.getenv("AMQP_URL"), help="URL AMQP do servidor central")
    ap.add_argument("--saida", default="loadgen_log.csv")
    ap.add_argument("--sem-confirmacao", action="store_true",
                    help="não aguarda o confirm do broker (o agente real aguarda)")
    sub = ap.add_subparsers(dest="modo", required=True)
    d = sub.add_parser("degraus")
    d.add_argument("--degraus", default="10,50,100,250,500,1000")
    d.add_argument("--duracao-degrau", type=int, default=600)
    m = sub.add_parser("maximo")
    m.add_argument("--duracao", type=int, default=120)
    m.add_argument("--sondas", type=int, default=1000)
    args = ap.parse_args()
    if not args.amqp:
        sys.exit("informe --amqp ou a variável AMQP_URL")

    print(f"perfil por sonda: {msgs_por_sonda_por_s() * 60:.2f} msg/min")
    pub = Publicador(args.amqp, not args.sem_confirmacao)
    with open(args.saida, "w", newline="") as f:
        log = csv.writer(f)
        log.writerow(["ts", "degrau", "sondas", "oferta_msg_s", "publicadas_total"])
        try:
            (modo_degraus if args.modo == "degraus" else modo_maximo)(args, pub, log)
        except KeyboardInterrupt:
            print("interrompido")
        finally:
            pub.fechar()
    print(f"log salvo em {args.saida}")


if __name__ == "__main__":
    main()
