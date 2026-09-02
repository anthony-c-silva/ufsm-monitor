"""Consultas de leitura para o dashboard (visão geral, séries, matriz, status).

Lê as *hypertables* criadas pela ingestão (TimescaleDB) diretamente via SQL, no
mesmo `engine` do controlador. Todas as funções toleram a ausência das tabelas
(banco recém-criado, sem medições ainda), retornando resultados vazios.

Segurança: nomes de tabela/campo usados em SQL vêm SEMPRE de listas fixas
(whitelists) — os valores fornecidos pelo cliente apenas selecionam uma entrada
dessas listas, nunca são interpolados diretamente.
"""
from sqlalchemy import text

from .db import engine

# Tabela tipada por medição (a de iperf3 chama-se iperf_measurements).
TYPE_TABLE = {
    "icmp": "icmp_measurements",
    "dns": "dns_measurements",
    "http": "http_measurements",
    "iperf3": "iperf_measurements",
}

# Campos numéricos consultáveis por tipo (whitelist para as séries).
TYPE_FIELDS = {
    "icmp": ["rtt_avg_ms", "rtt_min_ms", "rtt_max_ms", "rtt_p95_ms", "jitter_ms", "loss_pct"],
    "dns": ["elapsed_ms", "answer_count"],
    "http": ["total_ms", "ttfb_ms", "tcp_connect_ms", "tls_handshake_ms", "dns_ms",
             "http_status", "response_bytes"],
    "iperf3": ["throughput_bps", "retransmits", "duration_seconds", "bytes_transferred"],
}

# Métrica principal por tipo (usada na matriz e como padrão das séries).
PRIMARY_METRIC = {
    "icmp": "rtt_avg_ms",
    "dns": "elapsed_ms",
    "http": "total_ms",
    "iperf3": "throughput_bps",
}

# Métricas exibidas em cada célula da matriz.
MATRIX_METRICS = {
    "icmp": ["rtt_avg_ms", "loss_pct"],
    "dns": ["elapsed_ms", "answer_count"],
    "http": ["total_ms", "http_status"],
    "iperf3": ["throughput_bps", "retransmits"],
}


def _table_exists(conn, name: str) -> bool:
    return conn.execute(text("SELECT to_regclass(:n)"), {"n": f"public.{name}"}).scalar() is not None


def _iso(dt):
    return dt.isoformat() if dt is not None else None


def known_fields() -> dict:
    """Metadados para o front: campos disponíveis por tipo e métrica principal."""
    return {"fields": TYPE_FIELDS, "primary": PRIMARY_METRIC, "types": list(TYPE_TABLE)}


def series(mtype, field=None, probe_id=None, target=None, hours=24, limit=2000):
    table = TYPE_TABLE.get(mtype)
    if table is None:
        return {"type": mtype, "field": None, "points": [], "error": f"tipo inválido: {mtype}"}
    if not field or field not in TYPE_FIELDS[mtype]:
        field = PRIMARY_METRIC[mtype]

    clauses = ["observed_at > now() - make_interval(hours => :hours)", f"{field} IS NOT NULL"]
    params = {"hours": int(hours), "limit": int(limit)}
    if probe_id:
        clauses.append("probe_id = :probe")
        params["probe"] = probe_id
    if target:
        clauses.append("target = :target")
        params["target"] = target
    where = " AND ".join(clauses)
    sql = (f"SELECT observed_at, probe_id, target, {field} AS value FROM {table} "
           f"WHERE {where} ORDER BY observed_at ASC LIMIT :limit")

    with engine.connect() as conn:
        if not _table_exists(conn, table):
            return {"type": mtype, "field": field, "points": []}
        rows = conn.execute(text(sql), params).mappings().all()
    return {
        "type": mtype,
        "field": field,
        "points": [
            {"observed_at": _iso(r["observed_at"]), "probe_id": r["probe_id"],
             "target": r["target"], "value": r["value"]}
            for r in rows
        ],
    }


def matrix(mtype, hours=24):
    table = TYPE_TABLE.get(mtype)
    if table is None:
        return {"type": mtype, "metrics": [], "cells": []}
    cols = MATRIX_METRICS[mtype]
    select_cols = ", ".join(f"m.{c} AS {c}" for c in cols)
    sql = (
        f"SELECT DISTINCT ON (r.probe_id, r.target) "
        f"       r.probe_id, r.target, r.target_probe, r.status, r.observed_at, {select_cols} "
        f"FROM measurement_runs r "
        f"LEFT JOIN {table} m ON m.run_id = r.run_id AND m.observed_at = r.observed_at "
        f"WHERE r.measurement_type = :mt "
        f"      AND r.observed_at > now() - make_interval(hours => :hours) "
        f"ORDER BY r.probe_id, r.target, r.observed_at DESC"
    )
    with engine.connect() as conn:
        if not _table_exists(conn, "measurement_runs"):
            return {"type": mtype, "metrics": cols, "cells": []}
        rows = conn.execute(text(sql), {"mt": mtype, "hours": int(hours)}).mappings().all()

    primary = PRIMARY_METRIC[mtype]
    cells = []
    for r in rows:
        metrics = {c: r[c] for c in cols}
        cells.append({
            "source": r["probe_id"],
            "target": r["target"],
            "target_probe": r["target_probe"] or None,
            "status": r["status"],
            "observed_at": _iso(r["observed_at"]),
            "value": r.get(primary),
            "metrics": metrics,
        })
    return {"type": mtype, "primary": primary, "metrics": cols, "cells": cells}


def recent(limit=50):
    sql = (
        "SELECT observed_at, probe_id, measurement_type, target, target_probe, status, error_message "
        "FROM measurement_runs ORDER BY observed_at DESC LIMIT :limit"
    )
    with engine.connect() as conn:
        if not _table_exists(conn, "measurement_runs"):
            return []
        rows = conn.execute(text(sql), {"limit": int(limit)}).mappings().all()
    return [
        {"observed_at": _iso(r["observed_at"]), "probe_id": r["probe_id"],
         "type": r["measurement_type"], "target": r["target"],
         "target_probe": r["target_probe"] or None, "status": r["status"],
         "error_message": r["error_message"]}
        for r in rows
    ]


def run_stats(hours=24):
    sql = (
        "SELECT count(*) AS total, "
        "       count(*) FILTER (WHERE status = 'success') AS success, "
        "       count(*) FILTER (WHERE status <> 'success') AS error, "
        "       max(observed_at) AS last_observed "
        "FROM measurement_runs WHERE observed_at > now() - make_interval(hours => :hours)"
    )
    with engine.connect() as conn:
        if not _table_exists(conn, "measurement_runs"):
            return {"total": 0, "success": 0, "error": 0, "last_observed_at": None}
        r = conn.execute(text(sql), {"hours": int(hours)}).mappings().first()
    return {
        "total": int(r["total"] or 0),
        "success": int(r["success"] or 0),
        "error": int(r["error"] or 0),
        "last_observed_at": _iso(r["last_observed"]),
    }


def probe_activity(minutes=30):
    """Atividade recente por probe (a partir dos runs)."""
    sql = (
        "SELECT probe_id, max(observed_at) AS last_seen, count(*) AS runs, "
        "       count(*) FILTER (WHERE status = 'success') AS ok "
        "FROM measurement_runs WHERE observed_at > now() - make_interval(mins => :m) "
        "GROUP BY probe_id"
    )
    with engine.connect() as conn:
        if not _table_exists(conn, "measurement_runs"):
            return []
        rows = conn.execute(text(sql), {"m": int(minutes)}).mappings().all()
    return [
        {"probe_id": r["probe_id"], "last_seen": _iso(r["last_seen"]),
         "runs": int(r["runs"]), "ok": int(r["ok"])}
        for r in rows
    ]
