"""Scheduler automático (Fase 6).

Executa os planos HABILITADOS por `period_seconds` (com jitter, para evitar
sincronização rígida) e **serializa os testes de iperf3** (medições intrusivas):
um probe nunca participa de dois testes de vazão ao mesmo tempo, seja como origem
ou como destino (spec 11). Roda em threads dentro do processo do controlador.
"""
import logging
import random
import threading
import time
from datetime import datetime, timezone

from . import models, planning, publisher
from .config import IPERF3_SLACK_SECONDS, JOB_JITTER_PCT, SCHEDULER_TICK_SECONDS
from .db import SessionLocal
from .schemas import Plan

log = logging.getLogger("scheduler")


def _dispatch(specs, plan_id, plan_revision) -> int:
    """Publica as tarefas no RabbitMQ e registra em task_instances."""
    if not specs:
        return 0
    now = datetime.now(timezone.utc)
    task_dicts = [publisher.task_to_dict(s, plan_id, plan_revision, now) for s in specs]
    published = publisher.publish(task_dicts)
    db = SessionLocal()
    try:
        for d in task_dicts:
            db.add(
                models.TaskInstance(
                    task_id=d["task_id"],
                    plan_id=plan_id,
                    plan_revision=plan_revision,
                    job_id=d["job_id"],
                    type=d["type"],
                    source_probe=d["source_probe"],
                    target=d.get("target", ""),
                    target_probe=d.get("target_probe", ""),
                    published_at=now,
                )
            )
        db.commit()
    finally:
        db.close()
    return published


class Iperf3Serializer:
    """Fila de testes de vazão com reserva de origem+destino. Um worker despacha
    apenas tarefas cujos dois probes estejam livres, reservando-os e liberando-os
    após (duração + folga). Serializa naturalmente sem colisões."""

    def __init__(self, slack_seconds: int):
        self._lock = threading.Lock()
        self._busy: set[str] = set()
        self._queue: list = []  # (spec, plan_id, revision, duration)
        self._slack = slack_seconds
        threading.Thread(target=self._worker, name="iperf3-serializer", daemon=True).start()

    def submit(self, spec, plan_id, revision, duration):
        with self._lock:
            self._queue.append((spec, plan_id, revision, duration))

    @staticmethod
    def _keys(spec):
        return spec.source_probe, (spec.target_probe or spec.target)

    def _release(self, src, tgt):
        with self._lock:
            self._busy.discard(src)
            self._busy.discard(tgt)

    def _worker(self):
        while True:
            time.sleep(1)
            ready = []
            with self._lock:
                remaining = []
                for item in self._queue:
                    spec, _plan, _rev, duration = item
                    src, tgt = self._keys(spec)
                    if src in self._busy or tgt in self._busy:
                        remaining.append(item)
                        continue
                    self._busy.add(src)
                    self._busy.add(tgt)
                    ready.append(item)
                    threading.Timer(duration + self._slack, self._release, args=(src, tgt)).start()
                self._queue = remaining
            for spec, plan_id, revision, _duration in ready:
                try:
                    _dispatch([spec], plan_id, revision)
                    log.info("iperf3 despachado: %s -> %s", spec.source_probe, spec.target_probe or spec.target)
                except Exception as exc:  # noqa: BLE001
                    log.warning("iperf3: falha ao publicar: %s", exc)
                    self._release(*self._keys(spec))


class Scheduler:
    def __init__(self, tick: int, jitter_pct: float, serializer: Iperf3Serializer):
        self._tick = tick
        self._jitter = jitter_pct
        self._serializer = serializer
        self._next_due: dict = {}  # (plan_id, revision, job_id) -> epoch seconds
        self.last_runs: dict = {}  # para /scheduler/status

    def start(self):
        threading.Thread(target=self._loop, name="scheduler", daemon=True).start()

    def _loop(self):
        log.info("scheduler iniciado (tick=%ss, jitter=%.0f%%)", self._tick, self._jitter * 100)
        while True:
            try:
                self._run_due()
            except Exception as exc:  # noqa: BLE001
                log.warning("scheduler: erro no ciclo: %s", exc)
            time.sleep(self._tick)

    def _run_due(self):
        now = time.time()
        db = SessionLocal()
        try:
            rows = db.query(models.Plan).filter(models.Plan.enabled.is_(True)).all()
            for row in rows:
                try:
                    plan = Plan(**row.spec)
                except Exception as exc:  # noqa: BLE001
                    log.warning("plano %s inválido: %s", row.plan_id, exc)
                    continue
                for job in plan.jobs:
                    key = (plan.plan_id, plan.revision, job.id)
                    due = self._next_due.get(key)
                    if due is None:
                        # primeira vez: roda logo, com pequeno stagger
                        self._next_due[key] = now + random.uniform(0, self._tick)
                        continue
                    if now < due:
                        continue
                    period = max(job.period_seconds, 1)
                    jitter = period * self._jitter
                    self._next_due[key] = now + period + random.uniform(-jitter, jitter)
                    self._dispatch_job(db, plan, job)
        finally:
            db.close()

    def _dispatch_job(self, db, plan, job):
        sub = Plan(
            plan_id=plan.plan_id,
            revision=plan.revision,
            enabled=plan.enabled,
            groups=plan.groups,
            jobs=[job],
        )
        specs = planning.expand(sub, db)
        if not specs:
            return
        if job.type == "iperf3":
            for s in specs:
                self._serializer.submit(s, plan.plan_id, plan.revision, job.duration_seconds or 10)
            log.info("plano %s / job %s: %d iperf3 enfileirados (serializados)", plan.plan_id, job.id, len(specs))
        else:
            n = _dispatch(specs, plan.plan_id, plan.revision)
            log.info("plano %s / job %s: %d tarefas publicadas", plan.plan_id, job.id, n)
        self.last_runs[f"{plan.plan_id}:{job.id}"] = datetime.now(timezone.utc).isoformat()


_instance: Scheduler | None = None


def start():
    """Inicia o scheduler (chamado no startup do controlador)."""
    global _instance
    serializer = Iperf3Serializer(IPERF3_SLACK_SECONDS)
    _instance = Scheduler(SCHEDULER_TICK_SECONDS, JOB_JITTER_PCT, serializer)
    _instance.start()


def status() -> dict:
    return _instance.last_runs if _instance else {}
