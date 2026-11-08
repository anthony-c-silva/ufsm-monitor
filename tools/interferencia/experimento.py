#!/usr/bin/env python3
"""Experimento de interferência entre testes de vazão (SONDAR).

Executa, em várias rodadas, quatro condições com dois pares de sondas (A e B)
cujos caminhos atravessam um mesmo enlace:

  solo-a    só o par A                       (referência de A)
  solo-b    só o par B                       (referência de B)
  par-sem   A e B disparados juntos, modo "sonda"   (sem coordenação de trecho)
  par-com   A e B disparados juntos, modo "trecho"  (com coordenação de trecho)

A ordem das condições é sorteada em cada rodada. Ao final, busca os resultados
na API e grava:
  log_condicoes.csv            quando cada condição começou e terminou
  resultados_interferencia.csv um teste de vazão por linha, com a condição

Uso (no servidor, onde a API responde em localhost:8000):
  python3 experimento.py --par-a probe-ct-01:probe-srv-01 --par-b probe-ct-02:probe-ct-03
Opções úteis: --rodadas 10 --duracao 10 --usuario admin
A senha é pedida no terminal (ou lida de SONDAR_SENHA).
Somente biblioteca padrão do Python.
"""
import argparse
import csv
import getpass
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

PLANOS = {"solo-a": "exp-solo-a", "solo-b": "exp-solo-b", "par-sem": "exp-par", "par-com": "exp-par"}
MODO = {"solo-a": "sonda", "solo-b": "sonda", "par-sem": "sonda", "par-com": "trecho"}


class Api:
    def __init__(self, base, usuario, senha):
        self.base = base.rstrip("/")
        self.usuario, self.senha = usuario, senha
        self.token = None
        self.login()

    def _req(self, method, path, body=None, auth=True):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if auth and self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            if e.code == 401 and auth:
                self.login()
                return self._req(method, path, body, auth)
            raise SystemExit(f"API {method} {path}: HTTP {e.code} {e.read().decode()[:300]}")

    def login(self):
        r = self._req("POST", "/auth/login", {"username": self.usuario, "password": self.senha}, auth=False)
        self.token = r["access_token"]

    get = lambda self, p: self._req("GET", p)  # noqa: E731
    post = lambda self, p, b=None: self._req("POST", p, b if b is not None else {})  # noqa: E731
    put = lambda self, p, b: self._req("PUT", p, b)  # noqa: E731


def par(txt):
    try:
        src, dst = txt.split(":")
        return src.strip(), dst.strip()
    except ValueError:
        raise argparse.ArgumentTypeError("use ORIGEM:DESTINO, ex.: probe-ct-01:probe-srv-01")


def job(jid, src, dst, dur):
    return {"id": jid, "type": "iperf3", "sources": [f"probe:{src}"], "targets": [f"probe:{dst}"],
            "period_seconds": 3600, "duration_seconds": dur, "reverse": False}


def ocioso(api, timeout=180):
    """Espera a fila de coordenação esvaziar (nenhum teste rodando ou aguardando)."""
    fim = time.time() + timeout
    while time.time() < fim:
        c = api.get("/scheduler/coordination")
        if not c["running"] and not c["queue"]:
            return True
        time.sleep(2)
    return False


def agora():
    return datetime.now(timezone.utc)


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--usuario", default="admin")
    ap.add_argument("--par-a", type=par, required=True)
    ap.add_argument("--par-b", type=par, required=True)
    ap.add_argument("--rodadas", type=int, default=10)
    ap.add_argument("--duracao", type=int, default=10, help="duração de cada teste iperf3 (s)")
    ap.add_argument("--pausa", type=int, default=5, help="intervalo entre condições (s)")
    ap.add_argument("--semente", type=int, default=None)
    ap.add_argument("--saida", default=".")
    args = ap.parse_args()

    (a_src, a_dst), (b_src, b_dst) = args.par_a, args.par_b
    if len({a_src, a_dst, b_src, b_dst}) < 4:
        sys.exit("os dois pares precisam usar quatro sondas diferentes")
    senha = os.getenv("SONDAR_SENHA") or getpass.getpass(f"senha do usuário {args.usuario}: ")
    api = Api(args.api, args.usuario, senha)

    # 1. os dois pares precisam disputar um enlace no modo trecho
    chk = api.post("/scheduler/coordination/check", {"mode": "trecho", "pairs": [
        {"source_probe": a_src, "target_probe": a_dst}, {"source_probe": b_src, "target_probe": b_dst}]})
    if not chk["conflicts"]:
        sys.exit("os pares não compartilham nenhum enlace cadastrado. Cadastre o enlace e o caminho "
                 "das sondas na página Enlaces do painel antes de rodar o experimento.")
    print("enlace(s) compartilhado(s):", ", ".join(chk["conflicts"][0]["shared"]))

    # 2. planos do experimento (desabilitados: só rodam quando o script manda)
    d = args.duracao
    planos = {
        "exp-solo-a": [job("par-a", a_src, a_dst, d)],
        "exp-solo-b": [job("par-b", b_src, b_dst, d)],
        "exp-par": [job("par-a", a_src, a_dst, d), job("par-b", b_src, b_dst, d)],
    }
    for pid, jobs in planos.items():
        api.post("/plans", {"plan_id": pid, "revision": 1, "enabled": False, "groups": {}, "jobs": jobs})
    modo_original = api.get("/scheduler/coordination")["mode"]

    semente = args.semente if args.semente is not None else int(time.time())
    rnd = random.Random(semente)
    os.makedirs(args.saida, exist_ok=True)
    log_path = os.path.join(args.saida, "log_condicoes.csv")
    inicio = agora()
    log = []
    total = args.rodadas * 4
    print(f"{args.rodadas} rodadas x 4 condições, teste de {d}s, semente {semente}")
    try:
        with open(log_path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["rodada", "condicao", "modo", "plan_id", "inicio", "fim"])
            n = 0
            for rodada in range(1, args.rodadas + 1):
                ordem = list(PLANOS)
                rnd.shuffle(ordem)
                for cond in ordem:
                    n += 1
                    api.put("/scheduler/coordination", {"mode": MODO[cond]})
                    if not ocioso(api):
                        print("aviso: a fila não esvaziou a tempo; seguindo")
                    t0 = agora()
                    api.post(f"/plans/{PLANOS[cond]}/run")
                    time.sleep(2)
                    ocioso(api)
                    t1 = agora()
                    w.writerow([rodada, cond, MODO[cond], PLANOS[cond], t0.isoformat(), t1.isoformat()])
                    f.flush()
                    log.append((rodada, cond, PLANOS[cond], t0, t1))
                    print(f"[{n}/{total}] rodada {rodada} {cond:8s} {(t1 - t0).total_seconds():5.1f}s")
                    time.sleep(args.pausa)
    finally:
        api.put("/scheduler/coordination", {"mode": modo_original})
        print("modo de coordenação restaurado:", modo_original)

    # 3. resultados
    print("aguardando a ingestão dos últimos resultados...")
    time.sleep(20)
    horas = (agora() - inicio).total_seconds() / 3600 + 0.5
    runs = api.get(f"/measurements/iperf3/runs?plan_prefix=exp-&hours={horas:.2f}")
    res_path = os.path.join(args.saida, "resultados_interferencia.csv")
    folga = timedelta(seconds=20)
    casados = 0
    with open(res_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rodada", "condicao", "par", "probe_id", "target_probe", "started_at", "finished_at",
                    "status", "throughput_mbps", "retransmits", "error_message"])
        for r in runs:
            st = parse(r["started_at"]) or parse(r["observed_at"])
            if st is None or st < inicio - folga:
                continue
            # condição do mesmo plano que começou por último antes do teste
            # (tolerância de alguns segundos para diferença de relógio da sonda)
            cand = [c for c in log if c[2] == r["plan_id"] and c[3] - timedelta(seconds=3) <= st <= c[4] + folga]
            if not cand:
                continue
            rodada, cond, _p, _t0, _t1 = max(cand, key=lambda c: c[3])
            tput = r["throughput_bps"] / 1e6 if r["throughput_bps"] is not None else ""
            w.writerow([rodada, cond, "A" if r["job_id"] == "par-a" else "B", r["probe_id"], r["target_probe"],
                        r["started_at"], r["finished_at"], r["status"],
                        f"{tput:.2f}" if tput != "" else "", r["retransmits"], r["error_message"] or ""])
            casados += 1
    esperados = args.rodadas * 6
    print(f"{casados} de {esperados} testes esperados encontrados")
    print(f"gravados {log_path} e {res_path}")
    print("análise: python3 analisar.py", res_path)


if __name__ == "__main__":
    main()
