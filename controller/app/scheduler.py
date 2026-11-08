"""Scheduler automático (Fase 6).

Executa os planos HABILITADOS por `period_seconds` (com jitter, para evitar
sincronização rígida) e **serializa os testes de iperf3** (medições intrusivas):
os testes de vazão só rodam ao mesmo tempo quando não disputam sondas nem, no
modo ``trecho``, enlaces cadastrados (ver coordination.py). Roda em threads
dentro do processo do controlador.
"""
import logging
import random
import threading
import time
from collections import deque
from datetime import datetime, timezone

from . import coordination, models, planning, publisher
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
    """Fila dos testes de vazão. Cada teste ocupa um conjunto de recursos
    (sondas e, no modo ``trecho``, os enlaces do caminho; ver coordination.py).
    Um worker despacha apenas os testes cujos recursos estejam livres, reserva
    esses recursos e os libera após (duração + folga)."""

    def __init__(self, slack_seconds: int):
        self._lock = threading.Lock()
        self._busy: dict[str, int] = {}       # recurso -> id da reserva
        self._running: dict[int, dict] = {}   # id da reserva -> descrição
        self._queue: list[dict] = []
        self._log: deque = deque(maxlen=200)  # últimas decisões (despachos)
        self._seq = 0
        self._slack = slack_seconds
        threading.Thread(target=self._worker, name="iperf3-serializer", daemon=True).start()

    def submit(self, spec, plan_id, revision, duration):
        with self._lock:
            self._queue.append({
                "spec": spec, "plan_id": plan_id, "revision": revision,
                "duration": duration, "enqueued": time.time(), "blocked_by": [],
            })

    @staticmethod
    def _context():
        db = SessionLocal()
        try:
            return coordination.get_mode(db), coordination.chains(db)
        finally:
            db.close()

    def _release(self, rid):
        with self._lock:
            info = self._running.pop(rid, None)
            if info:
                for r in info["resources"]:
                    if self._busy.get(r) == rid:
                        del self._busy[r]

    def _worker(self):
        while True:
            time.sleep(1)
            with self._lock:
                pending = bool(self._queue)
            if not pending:
                continue
            try:
                mode, chain_of = self._context()
            except Exception as exc:  # noqa: BLE001
                log.warning("iperf3: falha ao ler a coordenação: %s", exc)
                continue
            ready = []
            now = time.time()
            with self._lock:
                remaining = []
                for item in self._queue:
                    s = item["spec"]
                    res = coordination.resources(mode, s.source_probe, s.target_probe, s.target, chain_of)
                    blocked = sorted(r for r in res if r in self._busy)
                    if blocked:
                        item["blocked_by"] = blocked
                        remaining.append(item)
                        continue
                    self._seq += 1
                    rid = self._seq
                    for r in res:
                        self._busy[r] = rid
                    entry = {
                        "id": rid,
                        "dispatched_at": datetime.now(timezone.utc).isoformat(),
                        "plan_id": item["plan_id"],
                        "source_probe": s.source_probe,
                        "target_probe": s.target_probe,
                        "target": s.target,
                        "mode": mode,
                        "resources": sorted(res),
                        "waited_s": round(now - item["enqueued"], 1),
                        "blocked_by": item["blocked_by"],
                        "duration": item["duration"],
                    }
                    self._running[rid] = entry
                    self._log.appendleft(entry)
                    ready.append((rid, item))
                    threading.Timer(item["duration"] + self._slack, self._release, args=(rid,)).start()
                self._queue = remaining
            for rid, item in ready:
                s = item["spec"]
                try:
                    _dispatch([s], item["plan_id"], item["revision"])
                    log.info("iperf3 despachado (%s): %s -> %s", mode, s.source_probe, s.target_probe or s.target)
                except Exception as exc:  # noqa: BLE001
                    log.warning("iperf3: falha ao publicar: %s", exc)
                    self._release(rid)

    def snapshot(self) -> dict:
        now = time.time()
        with self._lock:
            return {
                "busy": [
                    {"resource": r, "holder": f"{self._running[rid]['source_probe']} -> "
                                              f"{self._running[rid]['target_probe'] or self._running[rid]['target']}"}
                    for r, rid in sorted(self._busy.items()) if rid in self._running
                ],
                "running": list(self._running.values()),
                "queue": [
                    {"source_probe": i["spec"].source_probe,
                     "target_probe": i["spec"].target_probe,
                     "target": i["spec"].target,
                     "plan_id": i["plan_id"],
                     "waiting_s": round(now - i["enqueued"], 1),
                     "blocked_by": i["blocked_by"]}
                    for i in self._queue
                ],
                "recent": list(self._log)[:50],
            }


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
_serializer: Iperf3Serializer | None = None
_serializer_lock = threading.Lock()


def get_serializer() -> Iperf3Serializer:
    """Serializador único do processo (criado sob demanda)."""
    global _serializer
    with _serializer_lock:
        if _serializer is None:
            _serializer = Iperf3Serializer(IPERF3_SLACK_SECONDS)
        return _serializer


def start():
    """Inicia o scheduler (chamado no startup do controlador)."""
    global _instance
    _instance = Scheduler(SCHEDULER_TICK_SECONDS, JOB_JITTER_PCT, get_serializer())
    _instance.start()


def status() -> dict:
    return _instance.last_runs if _instance else {}


def coordination_snapshot() -> dict:
    return get_serializer().snapshot()
