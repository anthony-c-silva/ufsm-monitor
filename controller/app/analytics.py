"""Consultas de leitura para o dashboard (visão geral, séries, matriz, status).

Lê as *hypertables* criadas pela ingestão (TimescaleDB) diretamente via SQL, no
mesmo `engine` do controlador. Todas as funções toleram a ausência das tabelas
(banco recém-criado, sem medições ainda), retornando resultados vazios.

Segurança: nomes de tabela/campo usados em SQL vêm SEMPRE de listas fixas
(whitelists) — os valores fornecidos pelo cliente apenas selecionam uma entrada
dessas listas, nunca são interpolados diretamente.
"""
import json

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

    # Janela em minutos (aceita frações de hora, ex.: 0.5 => 30 min).
    minutes = max(1, int(round(float(hours) * 60)))
    clauses = ["observed_at > now() - make_interval(mins => :minutes)", f"{field} IS NOT NULL"]
    params = {"minutes": minutes, "limit": int(limit)}
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


def recent(limit=10):
    # Exclui 'sysinfo' (inventário do agente a cada 60s, sem destino) — não é medição.
    sql = (
        "SELECT observed_at, probe_id, measurement_type, target, target_probe, status, error_message "
        "FROM measurement_runs WHERE measurement_type <> 'sysinfo' "
        "ORDER BY observed_at DESC LIMIT :limit"
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
        "FROM measurement_runs "
        "WHERE measurement_type <> 'sysinfo' AND observed_at > now() - make_interval(hours => :hours)"
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


def activity(hours=24, bucket_minutes=30):
    """Contagem de medições ao longo do tempo (para o gráfico da visão geral)."""
    sql = (
        "SELECT time_bucket(make_interval(mins => :bmin), observed_at) AS bucket, "
        "       count(*) AS total, "
        "       count(*) FILTER (WHERE status = 'success') AS success "
        "FROM measurement_runs "
        "WHERE measurement_type <> 'sysinfo' AND observed_at > now() - make_interval(hours => :hours) "
        "GROUP BY bucket ORDER BY bucket ASC"
    )
    with engine.connect() as conn:
        if not _table_exists(conn, "measurement_runs"):
            return {"bucket_minutes": bucket_minutes, "points": []}
        rows = conn.execute(text(sql), {"bmin": int(bucket_minutes), "hours": int(hours)}).mappings().all()
    return {
        "bucket_minutes": bucket_minutes,
        "points": [
            {"t": _iso(r["bucket"]), "total": int(r["total"]),
             "success": int(r["success"]), "error": int(r["total"]) - int(r["success"])}
            for r in rows
        ],
    }


def traceroute_recent(probe_id=None, target=None, limit=20):
    """Traceroutes mais recentes, com os saltos (hops)."""
    clauses = []
    params = {"limit": int(limit)}
    if probe_id:
        clauses.append("probe_id = :probe")
        params["probe"] = probe_id
    if target:
        clauses.append("target = :target")
        params["target"] = target
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = (
        "SELECT observed_at, probe_id, target, target_probe, hop_count, hops "
        f"FROM traceroute_measurements{where} ORDER BY observed_at DESC LIMIT :limit"
    )
    with engine.connect() as conn:
        if not _table_exists(conn, "traceroute_measurements"):
            return []
        rows = conn.execute(text(sql), params).mappings().all()
    out = []
    for r in rows:
        hops = r["hops"]
        if isinstance(hops, str):
            try:
                hops = json.loads(hops)
            except Exception:  # noqa: BLE001
                hops = []
        out.append({
            "observed_at": _iso(r["observed_at"]), "probe_id": r["probe_id"],
            "target": r["target"], "target_probe": r["target_probe"] or None,
            "hop_count": r["hop_count"], "hops": hops or [],
        })
    return out


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


# --------------------------------------------------------------------------
# Saúde das sondas (inventário 'sysinfo' que o agente envia a cada 60 s)
# --------------------------------------------------------------------------
HEALTH_KEYS = [
    "cpu_temp_c", "cpu_freq_mhz", "cpu_usage_pct", "throttled", "throttled_now",
    "throttled_since_boot", "uptime_seconds", "link_speed_mbps", "agent_cpu_pct",
    "agent_rss_kb", "mem_total_kb", "mem_available_kb", "disk_total_bytes",
    "disk_free_bytes", "load_avg", "time_sync", "agent_version", "ip_address",
]


def _health_summary(observed_at, r):
    if isinstance(r, str):
        try:
            r = json.loads(r)
        except Exception:  # noqa: BLE001
            r = {}
    r = r or {}
    out = {k: r.get(k) for k in HEALTH_KEYS}
    mt, ma = r.get("mem_total_kb"), r.get("mem_available_kb")
    out["mem_used_pct"] = round(100 * (1 - ma / mt), 1) if mt and ma is not None else None
    dt, df = r.get("disk_total_bytes"), r.get("disk_free_bytes")
    out["disk_used_pct"] = round(100 * (1 - df / dt), 1) if dt and df is not None else None
    out["observed_at"] = _iso(observed_at)
    return out


def probe_health_latest(minutes=10, probe_id=None):
    """Último inventário de cada sonda (ou de uma sonda) dentro da janela."""
    sql = (
        "SELECT DISTINCT ON (probe_id) probe_id, observed_at, raw_payload->'result' AS r "
        "FROM measurement_runs "
        "WHERE measurement_type = 'sysinfo' AND status = 'success' "
        "AND observed_at > now() - make_interval(mins => :m) "
        + ("AND probe_id = :p " if probe_id else "")
        + "ORDER BY probe_id, observed_at DESC"
    )
    params = {"m": int(minutes)}
    if probe_id:
        params["p"] = probe_id
    with engine.connect() as conn:
        if not _table_exists(conn, "measurement_runs"):
            return {}
        rows = conn.execute(text(sql), params).mappings().all()
    return {row["probe_id"]: _health_summary(row["observed_at"], row["r"]) for row in rows}


def _num(key):
    # chaves fixas (nunca vindas do cliente)
    return f"(raw_payload->'result'->>'{key}')::double precision"


def probe_health_series(probe_id, hours=24, bucket_minutes=5):
    """Série temporal de temperatura, CPU, memória e consumo do agente."""
    sql = (
        "SELECT time_bucket(make_interval(mins => :b), observed_at) AS t, "
        f"avg({_num('cpu_temp_c')}) AS temp_avg, max({_num('cpu_temp_c')}) AS temp_max, "
        f"avg({_num('cpu_usage_pct')}) AS cpu_pct, "
        f"avg(100 * (1 - {_num('mem_available_kb')} / NULLIF({_num('mem_total_kb')}, 0))) AS mem_pct, "
        "avg((raw_payload->'result'->'load_avg'->>0)::double precision) AS load1, "
        f"avg({_num('cpu_freq_mhz')}) AS freq_mhz, "
        f"avg({_num('agent_cpu_pct')}) AS agent_cpu_pct, "
        f"avg({_num('agent_rss_kb')}) / 1024 AS agent_rss_mb, "
        "bool_or(jsonb_array_length(COALESCE(raw_payload->'result'->'throttled_now', '[]'::jsonb)) > 0) AS throttled "
        "FROM measurement_runs "
        "WHERE measurement_type = 'sysinfo' AND status = 'success' AND probe_id = :p "
        "AND observed_at > now() - make_interval(hours => :h) "
        "GROUP BY t ORDER BY t ASC"
    )
    with engine.connect() as conn:
        if not _table_exists(conn, "measurement_runs"):
            return []
        rows = conn.execute(
            text(sql), {"b": int(bucket_minutes), "h": int(hours), "p": probe_id}
        ).mappings().all()

    def rnd(v, n=1):
        return round(float(v), n) if v is not None else None

    return [
        {"t": _iso(r["t"]), "temp_avg": rnd(r["temp_avg"]), "temp_max": rnd(r["temp_max"]),
         "cpu_pct": rnd(r["cpu_pct"]), "mem_pct": rnd(r["mem_pct"]), "load1": rnd(r["load1"], 2),
         "freq_mhz": rnd(r["freq_mhz"], 0), "agent_cpu_pct": rnd(r["agent_cpu_pct"]),
         "agent_rss_mb": rnd(r["agent_rss_mb"]), "throttled": bool(r["throttled"])}
        for r in rows
    ]


def iperf_runs(plan_prefix="", hours=24, limit=5000):
    """Execuções de iperf3 com plano, job, horários e resultado (para experimentos)."""
    sql = (
        "SELECT r.run_id, r.observed_at, r.plan_id, r.job_id, r.probe_id, r.target, r.target_probe, "
        "       r.status, r.error_message, r.started_at, r.finished_at, "
        "       m.throughput_bps, m.retransmits, m.bytes_transferred, m.duration_seconds, m.direction "
        "FROM measurement_runs r "
        "LEFT JOIN iperf_measurements m ON m.run_id = r.run_id AND m.observed_at = r.observed_at "
        "WHERE r.measurement_type = 'iperf3' "
        "AND r.observed_at > now() - make_interval(mins => :mins) "
        "AND COALESCE(r.plan_id, '') LIKE :prefix "
        "ORDER BY r.observed_at ASC LIMIT :limit"
    )
    params = {"mins": max(1, int(round(float(hours) * 60))),
              "prefix": (plan_prefix or "").replace("%", "").replace("_", "\\_") + "%",
              "limit": int(limit)}
    with engine.connect() as conn:
        if not _table_exists(conn, "measurement_runs"):
            return []
        rows = conn.execute(text(sql), params).mappings().all()
    return [
        {"run_id": str(r["run_id"]), "observed_at": _iso(r["observed_at"]), "plan_id": r["plan_id"],
         "job_id": r["job_id"], "probe_id": r["probe_id"], "target": r["target"],
         "target_probe": r["target_probe"], "status": r["status"], "error_message": r["error_message"],
         "started_at": _iso(r["started_at"]), "finished_at": _iso(r["finished_at"]),
         "throughput_bps": r["throughput_bps"], "retransmits": r["retransmits"],
         "bytes_transferred": r["bytes_transferred"], "duration_seconds": r["duration_seconds"],
         "direction": r["direction"]}
        for r in rows
    ]
