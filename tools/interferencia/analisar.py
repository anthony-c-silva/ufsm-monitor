#!/usr/bin/env python3
"""Resume o experimento de interferência (resultados_interferencia.csv).

Para cada condição e par: número de testes, vazão média, desvio padrão,
mínimo, mediana e máximo (Mb/s), retransmissões médias e falhas. Para as
condições com os dois pares (par-sem e par-com), calcula em cada rodada a
sobreposição entre os dois testes e o tempo total para concluir ambos.

Gera resumo_interferencia.csv, rodadas_pares.csv e, se o matplotlib estiver
instalado, interferencia_vazao.png.

Uso: python3 analisar.py resultados_interferencia.csv
"""
import csv
import statistics as st
import sys
from collections import defaultdict
from datetime import datetime

ORDEM = ["solo-a", "solo-b", "par-sem", "par-com"]
ROTULO = {"solo-a": "A sozinho", "solo-b": "B sozinho", "par-sem": "A e B sem coordenação",
          "par-com": "A e B com coordenação"}


def ts(x):
    return datetime.fromisoformat(x.replace("Z", "+00:00")) if x else None


def main(path):
    rows = list(csv.DictReader(open(path, newline="")))
    grupos = defaultdict(list)
    falhas = defaultdict(int)
    for r in rows:
        k = (r["condicao"], r["par"])
        if r["status"] == "success" and r["throughput_mbps"]:
            grupos[k].append((float(r["throughput_mbps"]), int(r["retransmits"] or 0)))
        else:
            falhas[k] += 1

    resumo = []
    print(f"{'condição':24s} {'par':3s} {'n':>3s} {'média':>7s} {'desvio':>7s} {'mín':>7s} {'mediana':>7s} {'máx':>7s} {'retr.':>6s} {'falhas':>6s}")
    for cond in ORDEM:
        for p in ("A", "B"):
            v = grupos.get((cond, p), [])
            if not v and not falhas.get((cond, p)):
                continue
            t = [x[0] for x in v]
            linha = {
                "condicao": cond, "par": p, "n": len(t),
                "media_mbps": round(st.mean(t), 2) if t else "",
                "desvio_mbps": round(st.stdev(t), 2) if len(t) > 1 else "",
                "min_mbps": round(min(t), 2) if t else "",
                "mediana_mbps": round(st.median(t), 2) if t else "",
                "max_mbps": round(max(t), 2) if t else "",
                "retransmissoes_media": round(st.mean(x[1] for x in v), 1) if v else "",
                "falhas": falhas.get((cond, p), 0),
            }
            resumo.append(linha)
            print(f"{ROTULO[cond]:24s} {p:3s} {linha['n']:3d} {linha['media_mbps']!s:>7s} {linha['desvio_mbps']!s:>7s} "
                  f"{linha['min_mbps']!s:>7s} {linha['mediana_mbps']!s:>7s} {linha['max_mbps']!s:>7s} "
                  f"{linha['retransmissoes_media']!s:>6s} {linha['falhas']:6d}")
    with open("resumo_interferencia.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(resumo[0].keys()) if resumo else ["condicao"])
        w.writeheader()
        w.writerows(resumo)

    # sobreposição e tempo total nas condições com os dois pares
    por_rodada = defaultdict(dict)
    for r in rows:
        if r["condicao"] in ("par-sem", "par-com") and r["started_at"] and r["finished_at"]:
            por_rodada[(r["condicao"], r["rodada"])][r["par"]] = (ts(r["started_at"]), ts(r["finished_at"]))
    rod = []
    for (cond, rodada), d in sorted(por_rodada.items()):
        if "A" not in d or "B" not in d:
            continue
        (sa, fa), (sb, fb) = d["A"], d["B"]
        sobre = max(0.0, (min(fa, fb) - max(sa, sb)).total_seconds())
        total = (max(fa, fb) - min(sa, sb)).total_seconds()
        rod.append({"condicao": cond, "rodada": rodada, "sobreposicao_s": round(sobre, 1), "tempo_total_s": round(total, 1)})
    with open("rodadas_pares.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["condicao", "rodada", "sobreposicao_s", "tempo_total_s"])
        w.writeheader()
        w.writerows(rod)
    print()
    for cond in ("par-sem", "par-com"):
        v = [x for x in rod if x["condicao"] == cond]
        if v:
            print(f"{ROTULO[cond]:24s} sobreposição média {st.mean(x['sobreposicao_s'] for x in v):5.1f}s   "
                  f"tempo total médio {st.mean(x['tempo_total_s'] for x in v):5.1f}s   ({len(v)} rodadas)")

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("\nmatplotlib não instalado: gráfico não gerado")
        return
    dados, nomes = [], []
    for cond in ORDEM:
        for p in ("A", "B"):
            t = [x[0] for x in grupos.get((cond, p), [])]
            if t:
                dados.append(t)
                nomes.append(f"{ROTULO[cond]}\npar {p}")
    if dados:
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.boxplot(dados)
        ax.set_xticks(range(1, len(nomes) + 1))
        ax.set_xticklabels(nomes, fontsize=7)
        ax.set_ylabel("Vazão (Mb/s)")
        ax.grid(axis="y", alpha=0.3)
        fig.tight_layout()
        fig.savefig("interferencia_vazao.png", dpi=200)
        print("\ngerado interferencia_vazao.png")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
