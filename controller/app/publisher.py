"""Publicação de tarefas no RabbitMQ (exchange monitor.commands)."""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pika

from .config import AMQP_URL, TASK_TTL_SECONDS
from .planning import TaskSpec

EXCHANGE_COMMANDS = "monitor.commands"


def task_to_dict(spec: TaskSpec, plan_id: str, plan_revision: int, now: datetime) -> dict:
    """Monta o JSON da tarefa conforme contracts/task.schema.json."""
    d = {
        "task_id": str(uuid.uuid4()),
        "plan_id": plan_id,
        "plan_revision": plan_revision,
        "job_id": spec.job_id,
        "type": spec.type,
        "source_probe": spec.source_probe,
        "target": spec.target,
        "not_before": now.replace(microsecond=0).isoformat(),
        "expires_at": (now + timedelta(seconds=TASK_TTL_SECONDS)).replace(microsecond=0).isoformat(),
        "parameters": spec.parameters,
    }
    if spec.target_probe:
        d["target_probe"] = spec.target_probe
    return d


def publish(task_dicts: list[dict]) -> int:
    """Publica as tarefas com publisher confirms. Declara (idempotente) a fila de
    comandos de cada probe de origem para que a tarefa não se perca se o agente
    ainda não estiver conectado."""
    conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
    try:
        ch = conn.channel()
        ch.exchange_declare(EXCHANGE_COMMANDS, "topic", durable=True)
        for pid in {d["source_probe"] for d in task_dicts}:
            q = f"probe.{pid}.commands"
            ch.queue_declare(queue=q, durable=True)
            ch.queue_bind(queue=q, exchange=EXCHANGE_COMMANDS, routing_key=f"probe.{pid}.command")
        ch.confirm_delivery()

        published = 0
        for d in task_dicts:
            ch.basic_publish(
                exchange=EXCHANGE_COMMANDS,
                routing_key=f"probe.{d['source_probe']}.command",
                body=json.dumps(d).encode("utf-8"),
                properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
            )
            published += 1
        return published
    finally:
        conn.close()
