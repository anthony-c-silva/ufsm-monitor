"""Serviço de ingestão (Fase 5).

Consome os resultados de `monitor.ingestion.results` (RabbitMQ) e grava no
PostgreSQL/TimescaleDB. Substitui o `sink-results`.

Rode com:  python -m app.ingestion
(precisa da venv ativada, com o Postgres e o RabbitMQ no ar)

Modelo de dados (spec 10): uma tabela comum `measurement_runs` (auditoria +
raw_payload) e tabelas tipadas por medição, todas convertidas em *hypertables*
do TimescaleDB para consultas temporais eficientes.
"""
import json
import time

import pika
from sqlalchemy import text

from .config import AMQP_URL
from .db import engine

EXCHANGE_RESULTS = "monitor.results"
QUEUE = "monitor.ingestion.results"

TABLES_DDL = """
CREATE TABLE IF NOT EXISTS measurement_runs (
    run_id UUID NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    probe_id TEXT NOT NULL,
    measurement_type TEXT NOT NULL,
    target TEXT,
    target_probe TEXT,
    task_id UUID,
    plan_id TEXT,
    job_id TEXT,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_message TEXT,
    raw_payload JSONB,
    PRIMARY KEY (run_id, observed_at)
);
CREATE TABLE IF NOT EXISTS icmp_measurements (
    run_id UUID NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    probe_id TEXT NOT NULL,
    target TEXT,
    packets_sent INT,
    packets_received INT,
    loss_pct DOUBLE PRECISION,
    rtt_min_ms DOUBLE PRECISION,
    rtt_avg_ms DOUBLE PRECISION,
    rtt_max_ms DOUBLE PRECISION,
    jitter_ms DOUBLE PRECISION,
    rtt_p95_ms DOUBLE PRECISION,
    PRIMARY KEY (run_id, observed_at)
);
CREATE TABLE IF NOT EXISTS dns_measurements (
    run_id UUID NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    probe_id TEXT NOT NULL,
    target TEXT,
    resolver TEXT,
    qtype TEXT,
    transport TEXT,
    rcode TEXT,
    answer_count INT,
    elapsed_ms DOUBLE PRECISION,
    PRIMARY KEY (run_id, observed_at)
);
CREATE TABLE IF NOT EXISTS http_measurements (
    run_id UUID NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    probe_id TEXT NOT NULL,
    target TEXT,
    http_status INT,
    dns_ms DOUBLE PRECISION,
    tcp_connect_ms DOUBLE PRECISION,
    tls_handshake_ms DOUBLE PRECISION,
    ttfb_ms DOUBLE PRECISION,
    total_ms DOUBLE PRECISION,
    response_bytes BIGINT,
    PRIMARY KEY (run_id, observed_at)
);
CREATE TABLE IF NOT EXISTS iperf_measurements (
    run_id UUID NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    probe_id TEXT NOT NULL,
    target TEXT,
    target_probe TEXT,
    direction TEXT,
    protocol TEXT,
    duration_seconds DOUBLE PRECISION,
    bytes_transferred BIGINT,
    throughput_bps DOUBLE PRECISION,
    retransmits INT,
    PRIMARY KEY (run_id, observed_at)
);
"""

HYPERTABLES = [
    "measurement_runs",
    "icmp_measurements",
    "dns_measurements",
    "http_measurements",
    "iperf_measurements",
]


def ensure_schema():
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE"))
        for stmt in [s.strip() for s in TABLES_DDL.split(";") if s.strip()]:
            conn.execute(text(stmt))
        for t in HYPERTABLES:
            conn.execute(text(f"SELECT create_hypertable('{t}', 'observed_at', if_not_exists => TRUE)"))
    print("ingestão: schema pronto (hypertables ok)")


def _uuid_or_none(v):
    return v if v else None


def insert_result(env: dict):
    kind = env.get("kind")
    res = env.get("result") or {}
    common = {
        "run_id": env.get("run_id"),
        "observed_at": env.get("observed_at"),
        "probe_id": env.get("probe_id"),
        "kind": kind,
        "target": env.get("target"),
        "target_probe": env.get("target_probe") or None,
        "task_id": _uuid_or_none(env.get("task_id")),
        "plan_id": env.get("plan_id") or None,
        "job_id": env.get("job_id") or None,
        "status": env.get("status"),
        "started_at": env.get("started_at"),
        "finished_at": env.get("finished_at"),
        "error_message": env.get("error_message") or None,
        "raw": json.dumps(env),
    }
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO measurement_runs
                    (run_id, observed_at, probe_id, measurement_type, target, target_probe,
                     task_id, plan_id, job_id, status, started_at, finished_at, error_message, raw_payload)
                VALUES
                    (:run_id, :observed_at, :probe_id, :kind, :target, :target_probe,
                     :task_id, :plan_id, :job_id, :status, :started_at, :finished_at, :error_message,
                     CAST(:raw AS JSONB))
                ON CONFLICT (run_id, observed_at) DO NOTHING
                """
            ),
            common,
        )

        if env.get("status") != "success" or not res:
            return

        dims = {
            "run_id": common["run_id"],
            "observed_at": common["observed_at"],
            "probe_id": common["probe_id"],
            "target": common["target"],
        }
        if kind == "icmp":
            conn.execute(
                text(
                    """INSERT INTO icmp_measurements
                       (run_id, observed_at, probe_id, target, packets_sent, packets_received,
                        loss_pct, rtt_min_ms, rtt_avg_ms, rtt_max_ms, jitter_ms, rtt_p95_ms)
                       VALUES (:run_id, :observed_at, :probe_id, :target, :sent, :recv,
                        :loss, :rmin, :ravg, :rmax, :jit, :p95)
                       ON CONFLICT (run_id, observed_at) DO NOTHING"""
                ),
                {**dims, "sent": res.get("samples_sent"), "recv": res.get("samples_received"),
                 "loss": res.get("loss_pct"), "rmin": res.get("rtt_min_ms"),
                 "ravg": res.get("rtt_avg_ms"), "rmax": res.get("rtt_max_ms"),
                 "jit": res.get("jitter_ms"), "p95": res.get("rtt_p95_ms")},
            )
        elif kind == "dns":
            conn.execute(
                text(
                    """INSERT INTO dns_measurements
                       (run_id, observed_at, probe_id, target, resolver, qtype, transport,
                        rcode, answer_count, elapsed_ms)
                       VALUES (:run_id, :observed_at, :probe_id, :target, :resolver, :qtype, :transport,
                        :rcode, :answers, :elapsed)
                       ON CONFLICT (run_id, observed_at) DO NOTHING"""
                ),
                {**dims, "resolver": res.get("resolver"), "qtype": res.get("qtype"),
                 "transport": res.get("transport"), "rcode": res.get("rcode"),
                 "answers": res.get("answer_count"), "elapsed": res.get("elapsed_ms")},
            )
        elif kind == "http":
            conn.execute(
                text(
                    """INSERT INTO http_measurements
                       (run_id, observed_at, probe_id, target, http_status, dns_ms, tcp_connect_ms,
                        tls_handshake_ms, ttfb_ms, total_ms, response_bytes)
                       VALUES (:run_id, :observed_at, :probe_id, :target, :status, :dns, :tcp,
                        :tls, :ttfb, :total, :bytes)
                       ON CONFLICT (run_id, observed_at) DO NOTHING"""
                ),
                {**dims, "status": res.get("http_status"), "dns": res.get("dns_ms"),
                 "tcp": res.get("tcp_connect_ms"), "tls": res.get("tls_handshake_ms"),
                 "ttfb": res.get("ttfb_ms"), "total": res.get("total_ms"),
                 "bytes": res.get("response_bytes")},
            )
        elif kind == "iperf3":
            conn.execute(
                text(
                    """INSERT INTO iperf_measurements
                       (run_id, observed_at, probe_id, target, target_probe, direction, protocol,
                        duration_seconds, bytes_transferred, throughput_bps, retransmits)
                       VALUES (:run_id, :observed_at, :probe_id, :target, :tprobe, :direction, :protocol,
                        :dur, :bytes, :tput, :retr)
                       ON CONFLICT (run_id, observed_at) DO NOTHING"""
                ),
                {**dims, "tprobe": common["target_probe"], "direction": res.get("direction"),
                 "protocol": res.get("protocol"), "dur": res.get("duration_seconds"),
                 "bytes": res.get("bytes_transferred"), "tput": res.get("throughput_bps"),
                 "retr": res.get("retransmits")},
            )


def consume_forever():
    conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
    ch = conn.channel()
    ch.exchange_declare(EXCHANGE_RESULTS, "topic", durable=True)
    ch.queue_declare(queue=QUEUE, durable=True)
    ch.queue_bind(queue=QUEUE, exchange=EXCHANGE_RESULTS, routing_key="result.#")
    ch.basic_qos(prefetch_count=20)

    def on_message(chx, method, _props, body):
        try:
            env = json.loads(body)
            insert_result(env)
            chx.basic_ack(delivery_tag=method.delivery_tag)
            print(f"ingerido: {env.get('kind')} {env.get('status')} probe={env.get('probe_id')}")
        except Exception as exc:  # noqa: BLE001
            print("ingestão: erro ao processar mensagem:", exc)
            chx.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    ch.basic_consume(queue=QUEUE, on_message_callback=on_message)
    print(f"ingestão: consumindo {QUEUE} (Ctrl+C para sair)...")
    try:
        ch.start_consuming()
    finally:
        conn.close()


def run():
    ensure_schema()
    while True:
        try:
            consume_forever()
        except KeyboardInterrupt:
            print("ingestão: encerrando")
            return
        except Exception as exc:  # noqa: BLE001 (reconexão)
            print(f"ingestão: conexão perdida ({exc}); reconectando em 5s")
            time.sleep(5)


if __name__ == "__main__":
    run()
