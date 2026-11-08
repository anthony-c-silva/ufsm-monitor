"""Testes da regra de conflito entre testes de vazão (python -m pytest controller/tests)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import coordination as c  # noqa: E402

CHAINS = {
    "ct-01": ["sw100-ti"],
    "ct-02": ["sw100-ti"],
    "ct-03": ["acesso-ct03"],
    "anexo-1": ["porta-1", "uplink-anexo", "nucleo"],
    "anexo-2": ["porta-2", "uplink-anexo", "nucleo"],
    "predio-10": ["porta-10", "uplink-10", "nucleo"],
}
A = {"source_probe": "ct-01", "target_probe": "srv-01"}
B = {"source_probe": "ct-02", "target_probe": "ct-03"}


def test_modo_sonda_permite_pares_distintos():
    assert c.check_pairs("sonda", [A, B], CHAINS)["conflicts"] == []


def test_modo_trecho_detecta_enlace_compartilhado():
    r = c.check_pairs("trecho", [A, B], CHAINS)
    assert r["conflicts"] == [{"a": 0, "b": 1, "shared": ["enlace:sw100-ti"]}]


def test_modo_global_serializa_tudo():
    assert c.check_pairs("global", [A, B], CHAINS)["conflicts"][0]["shared"] == ["global"]


def test_mesma_sonda_conflita_em_qualquer_modo():
    pares = [{"source_probe": "ct-01", "target_probe": "srv-01"}, {"source_probe": "ct-03", "target_probe": "srv-01"}]
    for modo in c.MODES:
        assert c.check_pairs(modo, pares, CHAINS)["conflicts"], modo


def test_enlaces_acima_do_ponto_de_encontro_nao_contam():
    # duas sondas do mesmo anexo: o caminho entre elas não sobe ao núcleo
    assert c.path_links(CHAINS["anexo-1"], CHAINS["anexo-2"]) == {"porta-1", "porta-2"}
    # anexo para o prédio 10: passa pelos dois uplinks, mas não pelo núcleo
    assert c.path_links(CHAINS["anexo-1"], CHAINS["predio-10"]) == {"porta-1", "uplink-anexo", "porta-10", "uplink-10"}


def test_destino_externo_usa_a_cadeia_inteira():
    assert c.path_links(CHAINS["anexo-1"], None) == {"porta-1", "uplink-anexo", "nucleo"}


def test_testes_dentro_do_anexo_e_para_fora_conflitam_no_uplink():
    pares = [{"source_probe": "anexo-1", "target_probe": "predio-10"},
             {"source_probe": "anexo-2", "target": "200.18.0.1"}]
    shared = c.check_pairs("trecho", pares, CHAINS)["conflicts"][0]["shared"]
    assert shared == ["enlace:uplink-anexo"]


def test_sonda_sem_cadeia_segue_regra_por_sonda():
    pares = [{"source_probe": "x", "target_probe": "y"}, {"source_probe": "z", "target_probe": "w"}]
    assert c.check_pairs("trecho", pares, CHAINS)["conflicts"] == []
