"""Validação e expansão de planos declarativos em tarefas concretas (spec 7)."""
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from . import models
from .config import MAX_IPERF_DURATION, MAX_TASKS_PER_CYCLE, MIN_PERIOD_SECONDS
from .schemas import Job, Plan


@dataclass
class TaskSpec:
    """Uma tarefa concreta resultante da expansão de um job."""
    type: str
    source_probe: str
    target: str
    target_probe: str
    job_id: str
    parameters: dict = field(default_factory=dict)


# ----------------------------------------------------------------------------
# Resolução de referências
# ----------------------------------------------------------------------------

def _resolve_group(name: str, plan: Plan, db: Session):
    """Retorna a lista de probes de um grupo (grupos do plano têm prioridade),
    ou None se o grupo não existir."""
    if name in plan.groups:
        return plan.groups[name]
    g = db.get(models.Group, name)
    return list(g.members) if g else None


def _ref_probes(ref: str, plan: Plan, db: Session):
    """Resolve uma referência de origem/destino em lista de probe_ids, ou None
    se a referência for inválida."""
    if ref.startswith("group:"):
        return _resolve_group(ref[len("group:"):], plan, db)
    if ref.startswith("probe:"):
        return [ref[len("probe:"):]]
    return [ref]  # id de probe informado diretamente


def resolve_sources(job: Job, plan: Plan, db: Session) -> list[str]:
    probes: set[str] = set()
    for ref in job.sources:
        found = _ref_probes(ref, plan, db)
        if found:
            probes.update(found)
    return sorted(probes)


def resolve_targets(job: Job, plan: Plan, db: Session):
    """Retorna tuplas (kind, address, target_probe) para cada destino do job."""
    out = []
    for ref in job.targets:
        if ref.startswith("group:") or ref.startswith("probe:"):
            for pid in (_ref_probes(ref, plan, db) or []):
                p = db.get(models.Probe, pid)
                out.append(("probe", p.address if p else "", pid))
        else:
            out.append(("external", ref, ""))  # endereço literal (allowlist)
    return out


# ----------------------------------------------------------------------------
# Parâmetros por tipo de medição
# ----------------------------------------------------------------------------

def build_parameters(job: Job) -> dict:
    t = job.type
    if t == "icmp":
        return {"samples": job.samples or 10, "timeout_ms": job.timeout_ms or 1000}
    if t == "iperf3":
        return {"duration_seconds": job.duration_seconds or 10, "reverse": bool(job.reverse)}
    if t == "dns":
        p = {"qtype": job.qtype or "A", "tcp": bool(job.tcp), "timeout_ms": job.timeout_ms or 2000}
        if job.resolver:
            p["resolver"] = job.resolver
        return p
    if t == "http":
        return {"method": job.method or "GET", "timeout_ms": job.timeout_ms or 5000}
    if t == "traceroute":
        return {"cycles": job.cycles or 3, "max_hops": job.max_hops or 30}
    return {}


# ----------------------------------------------------------------------------
# Expansão
# ----------------------------------------------------------------------------

def expand(plan: Plan, db: Session) -> list[TaskSpec]:
    tasks: list[TaskSpec] = []
    for job in plan.jobs:
        sources = resolve_sources(job, plan, db)
        targets = resolve_targets(job, plan, db)
        for src in sources:
            for kind, addr, tpid in targets:
                if job.exclude_self and kind == "probe" and tpid == src:
                    continue
                params = build_parameters(job)
                if job.type == "dns":
                    params["qname"] = addr  # o destino é o nome consultado
                tasks.append(
                    TaskSpec(
                        type=job.type,
                        source_probe=src,
                        target=addr,
                        target_probe=tpid if kind == "probe" else "",
                        job_id=job.id,
                        parameters=params,
                    )
                )
    return tasks


def summarize(plan: Plan, tasks: list[TaskSpec]) -> dict:
    by_type: dict[str, int] = {}
    for t in tasks:
        by_type[t.type] = by_type.get(t.type, 0) + 1
    return {
        "plan_id": plan.plan_id,
        "revision": plan.revision,
        "total_tasks_per_cycle": len(tasks),
        "tasks_by_type": by_type,
        "iperf3_tasks": by_type.get("iperf3", 0),
    }


# ----------------------------------------------------------------------------
# Validação (spec 7)
# ----------------------------------------------------------------------------

def validate(plan: Plan, db: Session) -> list[str]:
    errors: list[str] = []

    for job in plan.jobs:
        # Origens
        for ref in job.sources:
            probes = _ref_probes(ref, plan, db)
            if probes is None:
                errors.append(f"job '{job.id}': grupo de origem inexistente: {ref}")
                continue
            for pid in probes:
                p = db.get(models.Probe, pid)
                if p is None:
                    errors.append(f"job '{job.id}': probe de origem inexistente: {pid}")
                elif not p.active:
                    errors.append(f"job '{job.id}': probe de origem inativo: {pid}")

        # Destinos
        for ref in job.targets:
            if ref.startswith("group:") or ref.startswith("probe:"):
                if _ref_probes(ref, plan, db) is None:
                    errors.append(f"job '{job.id}': grupo de destino inexistente: {ref}")
            else:
                authorized = db.query(models.Target).filter(models.Target.address == ref).first()
                if authorized is None:
                    errors.append(
                        f"job '{job.id}': destino externo não autorizado (cadastre em /targets): {ref}"
                    )

        # Frequência
        if job.period_seconds < MIN_PERIOD_SECONDS:
            errors.append(
                f"job '{job.id}': period_seconds {job.period_seconds} abaixo do mínimo {MIN_PERIOD_SECONDS}"
            )

        # Duração máxima de iperf3
        if job.type == "iperf3" and (job.duration_seconds or 10) > MAX_IPERF_DURATION:
            errors.append(
                f"job '{job.id}': duração iperf3 {job.duration_seconds}s acima do máximo {MAX_IPERF_DURATION}s"
            )

    # Quantidade total de tarefas por ciclo
    try:
        tasks = expand(plan, db)
        if len(tasks) > MAX_TASKS_PER_CYCLE:
            errors.append(
                f"plano gera {len(tasks)} tarefas/ciclo, acima do limite {MAX_TASKS_PER_CYCLE}"
            )
    except Exception as exc:  # noqa: BLE001
        errors.append(f"falha ao expandir o plano: {exc}")

    return errors
