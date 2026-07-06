"""Controlador central (FastAPI): inventário, planos, validação/expansão e
publicação de tarefas no RabbitMQ.

Rode com:  uvicorn app.main:app --reload
Docs interativas:  http://localhost:8000/docs
"""
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from . import models, planning, publisher
from .db import Base, engine, get_db
from .schemas import GroupIn, Plan, ProbeIn, TargetIn


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Cria as tabelas no startup (Fase 4; migrações com Alembic virão depois).
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="UFSM Monitor Controller", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


# --------------------------------------------------------------------------
# Probes
# --------------------------------------------------------------------------
@app.post("/probes")
def upsert_probe(body: ProbeIn, db: Session = Depends(get_db)):
    p = db.get(models.Probe, body.probe_id)
    if p is None:
        p = models.Probe(probe_id=body.probe_id)
        db.add(p)
    p.hostname = body.hostname
    p.address = body.address
    p.deployment = body.deployment
    p.vlan = body.vlan
    p.active = body.active
    db.commit()
    return _probe_dict(p)


@app.get("/probes")
def list_probes(db: Session = Depends(get_db)):
    return [_probe_dict(p) for p in db.query(models.Probe).all()]


# --------------------------------------------------------------------------
# Targets (allowlist de destinos)
# --------------------------------------------------------------------------
@app.post("/targets")
def upsert_target(body: TargetIn, db: Session = Depends(get_db)):
    t = db.query(models.Target).filter(models.Target.name == body.name).first()
    if t is None:
        t = models.Target(name=body.name)
        db.add(t)
    t.kind = body.kind
    t.address = body.address
    db.commit()
    return _target_dict(t)


@app.get("/targets")
def list_targets(db: Session = Depends(get_db)):
    return [_target_dict(t) for t in db.query(models.Target).all()]


# --------------------------------------------------------------------------
# Groups
# --------------------------------------------------------------------------
@app.post("/groups")
def upsert_group(body: GroupIn, db: Session = Depends(get_db)):
    g = db.get(models.Group, body.name)
    if g is None:
        g = models.Group(name=body.name)
        db.add(g)
    g.members = body.members
    db.commit()
    return {"name": g.name, "members": g.members}


@app.get("/groups")
def list_groups(db: Session = Depends(get_db)):
    return [{"name": g.name, "members": g.members} for g in db.query(models.Group).all()]


# --------------------------------------------------------------------------
# Plans
# --------------------------------------------------------------------------
@app.post("/plans/validate")
def validate_plan(plan: Plan, db: Session = Depends(get_db)):
    errors = planning.validate(plan, db)
    tasks = [] if errors else planning.expand(plan, db)
    return {"valid": not errors, "errors": errors, "expansion": planning.summarize(plan, tasks)}


@app.post("/plans")
def create_plan(plan: Plan, db: Session = Depends(get_db)):
    errors = planning.validate(plan, db)
    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})
    row = db.get(models.Plan, plan.plan_id)
    if row is None:
        row = models.Plan(plan_id=plan.plan_id)
        db.add(row)
    row.revision = plan.revision
    row.enabled = plan.enabled
    row.spec = plan.model_dump()
    db.commit()
    return {"stored": True, "expansion": planning.summarize(plan, planning.expand(plan, db))}


@app.get("/plans")
def list_plans(db: Session = Depends(get_db)):
    return [
        {"plan_id": p.plan_id, "revision": p.revision, "enabled": p.enabled}
        for p in db.query(models.Plan).all()
    ]


@app.get("/plans/{plan_id}")
def get_plan(plan_id: str, db: Session = Depends(get_db)):
    row = db.get(models.Plan, plan_id)
    if row is None:
        raise HTTPException(status_code=404, detail="plano não encontrado")
    return {"plan_id": row.plan_id, "revision": row.revision, "enabled": row.enabled, "spec": row.spec}


@app.post("/plans/{plan_id}/run")
def run_plan(plan_id: str, db: Session = Depends(get_db)):
    row = db.get(models.Plan, plan_id)
    if row is None:
        raise HTTPException(status_code=404, detail="plano não encontrado")
    plan = Plan(**row.spec)

    errors = planning.validate(plan, db)
    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})

    tasks = planning.expand(plan, db)
    now = datetime.now(timezone.utc)
    task_dicts = [publisher.task_to_dict(t, plan.plan_id, plan.revision, now) for t in tasks]

    try:
        published = publisher.publish(task_dicts)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"falha ao publicar no RabbitMQ: {exc}")

    for d in task_dicts:
        db.add(
            models.TaskInstance(
                task_id=d["task_id"],
                plan_id=plan.plan_id,
                plan_revision=plan.revision,
                job_id=d["job_id"],
                type=d["type"],
                source_probe=d["source_probe"],
                target=d.get("target", ""),
                target_probe=d.get("target_probe", ""),
                published_at=now,
            )
        )
    db.commit()
    return {"published": published, "expansion": planning.summarize(plan, tasks)}


# --------------------------------------------------------------------------
# Serializers
# --------------------------------------------------------------------------
def _probe_dict(p: models.Probe) -> dict:
    return {
        "probe_id": p.probe_id,
        "hostname": p.hostname,
        "address": p.address,
        "deployment": p.deployment,
        "vlan": p.vlan,
        "active": p.active,
    }


def _target_dict(t: models.Target) -> dict:
    return {"id": t.id, "name": t.name, "kind": t.kind, "address": t.address}
