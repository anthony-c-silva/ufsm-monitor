"""Coordenação dos testes de vazão (iperf3).

Cada teste de vazão ocupa um conjunto de *recursos*. Dois testes só podem rodar
ao mesmo tempo se os seus conjuntos forem disjuntos. Os recursos dependem do
modo de coordenação:

- ``sonda``: as duas sondas do teste (origem e destino). É a regra usual das
  plataformas de medição: uma sonda não participa de dois testes de vazão ao
  mesmo tempo, mas testes entre pares distintos podem coincidir mesmo quando
  atravessam o mesmo enlace.
- ``trecho``: as sondas e os enlaces do caminho. O operador cadastra, para cada
  sonda, a cadeia de enlaces entre ela e o núcleo da rede (topologia em
  árvore). O caminho entre duas sondas é formado pelos enlaces que aparecem em
  apenas uma das duas cadeias (diferença simétrica), pois os enlaces comuns
  ficam acima do ponto em que os dois caminhos se encontram. Para um destino
  que não é sonda, considera-se a cadeia inteira da origem.
- ``global``: um único teste de vazão por vez em toda a rede.

Sondas sem cadeia cadastrada participam apenas com os recursos de sonda, o que
equivale ao modo ``sonda`` para elas.
"""
from sqlalchemy.orm import Session

from . import models

MODES = {
    "sonda": "Uma sonda não participa de dois testes ao mesmo tempo (pares distintos podem coincidir).",
    "trecho": "Testes que atravessam um mesmo enlace cadastrado não rodam ao mesmo tempo.",
    "global": "Apenas um teste de vazão por vez em toda a rede.",
}
DEFAULT_MODE = "trecho"
SETTING_KEY = "iperf3_coordination_mode"


def get_mode(db: Session) -> str:
    row = db.get(models.Setting, SETTING_KEY)
    if row and row.value in MODES:
        return row.value
    return DEFAULT_MODE


def set_mode(db: Session, mode: str) -> str:
    if mode not in MODES:
        raise ValueError(f"modo inválido: {mode} (use {', '.join(MODES)})")
    row = db.get(models.Setting, SETTING_KEY)
    if row is None:
        row = models.Setting(key=SETTING_KEY, value=mode)
        db.add(row)
    else:
        row.value = mode
    db.commit()
    return mode


def chains(db: Session) -> dict[str, list[str]]:
    """Cadeia de enlaces de cada sonda (apenas as cadastradas)."""
    return {u.probe_id: list(u.links or []) for u in db.query(models.ProbeUplink).all()}


def path_links(src_chain: list[str], dst_chain: list[str] | None) -> set[str]:
    """Enlaces atravessados entre a origem e o destino numa topologia em árvore."""
    a = set(src_chain or [])
    if dst_chain is None:  # destino fora do inventário de sondas
        return a
    return a ^ set(dst_chain)


def resources(mode: str, src: str, target_probe: str, target: str,
              chain_of: dict[str, list[str]]) -> set[str]:
    """Conjunto de recursos ocupados por um teste de vazão."""
    res = {f"sonda:{src}"}
    if target_probe:
        res.add(f"sonda:{target_probe}")
    else:
        res.add(f"destino:{target}")
    if mode == "global":
        res.add("global")
    elif mode == "trecho":
        dst_chain = chain_of.get(target_probe, []) if target_probe else None
        for link in path_links(chain_of.get(src, []), dst_chain):
            res.add(f"enlace:{link}")
    return res


def check_pairs(mode: str, pairs: list[dict], chain_of: dict[str, list[str]]) -> dict:
    """Recursos de cada par e os pares que entram em conflito no modo informado."""
    items = []
    for p in pairs:
        src = p.get("source_probe", "")
        tprobe = p.get("target_probe", "")
        target = p.get("target", "") or tprobe
        items.append({
            "source_probe": src,
            "target_probe": tprobe,
            "target": target,
            "resources": sorted(resources(mode, src, tprobe, target, chain_of)),
        })
    conflicts = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            shared = sorted(set(items[i]["resources"]) & set(items[j]["resources"]))
            if shared:
                conflicts.append({"a": i, "b": j, "shared": shared})
    return {"mode": mode, "pairs": items, "conflicts": conflicts}
