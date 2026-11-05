#!/usr/bin/env python3
"""Coleta métricas do servidor central durante o teste de escalabilidade.

Rode NO SERVIDOR (precisa do docker). A cada --intervalo segundos registra
  - fila monitor.ingestion.results: mensagens pendentes e taxas de entrada/consumo
    (API de gerência do RabbitMQ, porta 15672)
  - CPU e memória de cada contêiner ufsm-* (docker stats)
  - tamanho do banco e atraso de ingestão das sondas simuladas
    (agora - observed_at mais recente já gravado)

Uso
  python3 monitor.py --saida monitor_log.csv
Credenciais da API do RabbitMQ: variáveis RABBIT_USER e RABBIT_PASS
(padrão do docker-compose: guest/guest).
"""
import argparse
import base64
import csv
import json
import os
import subprocess
import time
import urllib.request
from datetime import datetime, timezone

FILA = "monitor.ingestion.results"
SQL_DB = (
    "SELECT pg_database_size('monitor'), "
    "COALESCE(EXTRACT(EPOCH FROM now() - max(observed_at)), -1) "
    "FROM measurement_runs WHERE probe_id LIKE 'sim-%' "
    "AND observed_at > now() - interval '30 minutes'"
)


def fila(api, user, pw):
    req = urllib.request.Request(f"{api}/api/queues/%2F/{FILA}")
    tok = base64.b64encode(f"{user}:{pw}".encode()).decode()
    req.add_header("Authorization", f"Basic {tok}")
    with urllib.request.urlopen(req, timeout=5) as r:
        q = json.load(r)
    st = q.get("message_stats", {})
    taxa = lambda k: st.get(k, {}).get("rate", 0.0)  # noqa: E731
    return q.get("messages", 0), taxa("publish_details"), taxa("ack_details")


def para_mib(txt):
    txt = txt.strip()
    for suf, mult in (("GiB", 1024), ("MiB", 1), ("KiB", 1 / 1024), ("GB", 953.67),
                      ("MB", 0.9537), ("kB", 0.000931), ("B", 1 / 1048576)):
        if txt.endswith(suf):
            return float(txt[: -len(suf)]) * mult
    return 0.0


def conteineres():
    out = subprocess.run(
        ["docker", "stats", "--no-stream", "--format", "{{.Name}};{{.CPUPerc}};{{.MemUsage}}"],
        capture_output=True, text=True, timeout=30).stdout
    res = {}
    for linha in out.strip().splitlines():
        nome, cpu, mem = linha.split(";")
        if nome.startswith("ufsm-"):
            res[nome] = (float(cpu.rstrip("%") or 0), para_mib(mem.split("/")[0]))
    return res


def banco(container, user):
    out = subprocess.run(
        ["docker", "exec", container, "psql", "-U", user, "-d", "monitor", "-tAF", ";", "-c", SQL_DB],
        capture_output=True, text=True, timeout=30).stdout.strip()
    tam, atraso = out.split(";") if out else ("0", "-1")
    return int(tam), float(atraso)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--saida", default="monitor_log.csv")
    ap.add_argument("--intervalo", type=float, default=5)
    ap.add_argument("--api", default="http://localhost:15672")
    ap.add_argument("--pg-container", default="ufsm-timescaledb")
    ap.add_argument("--pg-user", default="ufsm")
    args = ap.parse_args()
    user, pw = os.getenv("RABBIT_USER", "guest"), os.getenv("RABBIT_PASS", "guest")

    nomes = sorted(conteineres())
    cab = ["ts", "fila_msgs", "entrada_msg_s", "consumo_msg_s", "db_bytes", "atraso_ingestao_s"]
    for n in nomes:
        cab += [f"{n}_cpu_pct", f"{n}_mem_mib"]
    with open(args.saida, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cab)
        print("coletando (Ctrl+C para parar)...", flush=True)
        try:
            while True:
                t = time.time()
                ts = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
                try:
                    q = fila(args.api, user, pw)
                except Exception as exc:  # noqa: BLE001
                    print("rabbitmq:", exc)
                    q = ("", "", "")
                c = conteineres()
                tam, atraso = banco(args.pg_container, args.pg_user)
                linha = [ts, *q, tam, round(atraso, 2)]
                for n in nomes:
                    cpu, mem = c.get(n, ("", ""))
                    linha += [cpu, round(mem, 1) if mem != "" else ""]
                w.writerow(linha)
                f.flush()
                print(f"{ts} fila={q[0]} entrada={q[1]} consumo={q[2]} atraso={atraso:.1f}s", flush=True)
                time.sleep(max(0, args.intervalo - (time.time() - t)))
        except KeyboardInterrupt:
            print(f"\nlog salvo em {args.saida}")


if __name__ == "__main__":
    main()
