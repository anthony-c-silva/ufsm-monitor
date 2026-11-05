#!/usr/bin/env python3
"""Junta loadgen_log.csv e monitor_log.csv e resume cada degrau.

Para cada degrau descarta os primeiros 30% do tempo (aquecimento) e calcula
carga oferecida, taxa de consumo da ingestão, fila média e máxima, atraso de
ingestão (p95), CPU e memória médias por contêiner e crescimento do banco por
mensagem. Gera resumo_degraus.csv e gráficos PNG.

Uso
  python analisar.py loadgen_log.csv monitor_log.csv
Requer pandas e matplotlib.
"""
import sys

import matplotlib
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def main(lg_path, mon_path):
    lg = pd.read_csv(lg_path, parse_dates=["ts"])
    mon = pd.read_csv(mon_path, parse_dates=["ts"])
    lg = lg[lg["degrau"] > 0]
    linhas = []
    for passo, g in lg.groupby("degrau"):
        ini, fim = g["ts"].min(), g["ts"].max()
        corte = ini + (fim - ini) * 0.3
        m = mon[(mon["ts"] >= corte) & (mon["ts"] <= fim)]
        if m.empty:
            continue
        gg = g[g["ts"] >= corte]
        dur = (gg["ts"].max() - gg["ts"].min()).total_seconds() or 1
        publicadas = gg["publicadas_total"].max() - gg["publicadas_total"].min()
        d = {
            "degrau": passo,
            "sondas": int(g["sondas"].iloc[0]),
            "oferta_msg_s": float(g["oferta_msg_s"].iloc[0]),
            "publicado_msg_s": round(publicadas / dur, 2),
            "consumo_msg_s": round(m["consumo_msg_s"].mean(), 2),
            "fila_media": round(m["fila_msgs"].mean(), 1),
            "fila_max": int(m["fila_msgs"].max()),
            "atraso_p95_s": round(m["atraso_ingestao_s"].quantile(0.95), 2),
        }
        db = m["db_bytes"]
        d["bytes_por_msg"] = round((db.iloc[-1] - db.iloc[0]) / publicadas, 1) if publicadas else None
        for col in m.columns:
            if col.endswith("_cpu_pct") or col.endswith("_mem_mib"):
                d[col] = round(m[col].mean(), 2)
        linhas.append(d)
    res = pd.DataFrame(linhas)
    res.to_csv("resumo_degraus.csv", index=False)
    print(res.to_string(index=False))

    cpu_cols = [c for c in res.columns if c.endswith("_cpu_pct")]
    mem_cols = [c for c in res.columns if c.endswith("_mem_mib")]
    for cols, rot, arq in ((cpu_cols, "CPU média (%)", "cpu_por_sondas.png"),
                           (mem_cols, "Memória média (MiB)", "memoria_por_sondas.png")):
        fig, ax = plt.subplots(figsize=(6, 3.5))
        for c in cols:
            ax.plot(res["sondas"], res[c], marker="o",
                    label=c.replace("ufsm-", "").rsplit("_", 2)[0])
        ax.set_xlabel("Sondas simuladas")
        ax.set_ylabel(rot)
        ax.grid(alpha=0.3)
        ax.legend(fontsize=8)
        fig.tight_layout()
        fig.savefig(arq, dpi=200)

    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.plot(res["sondas"], res["oferta_msg_s"], marker="o", label="carga oferecida")
    ax.plot(res["sondas"], res["consumo_msg_s"], marker="s", label="consumo da ingestão")
    ax.set_xlabel("Sondas simuladas")
    ax.set_ylabel("Mensagens por segundo")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig("vazao_ingestao.png", dpi=200)
    print("gerados resumo_degraus.csv, cpu_por_sondas.png, memoria_por_sondas.png, vazao_ingestao.png")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
