"""Controlador central (FastAPI): inventário, planos, validação/expansão e
publicação de tarefas no RabbitMQ.

Rode com:  uvicorn app.main:app --reload
Docs interativas:  http://localhost:8000/docs
"""
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from . import analytics, auth, ingestion, models, planning, publisher, scheduler
from .config import FRONTEND_ORIGINS, SCHEDULER_ENABLED
from .db import Base, SessionLocal, engine, get_db
from .schemas import (
    GroupIn,
    LoginIn,
    PasswordChangeIn,
    Plan,
    ProbeIn,
    RefreshIn,
    TargetIn,
    UserIn,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Cria as tabelas no startup (Fase 4; migrações com Alembic virão depois).
    Base.metadata.create_all(bind=engine)
    # Garante o schema de medições (hypertables) para os endpoints de leitura,
    # caso a ingestão ainda não tenha rodado. Idempotente.
    try:
        ingestion.ensure_schema()
    except Exception as exc:  # noqa: BLE001
        print("aviso: schema de medições ainda indisponível:", exc)
    # Cria o admin inicial (admin/admin, troca obrigatória) se não houver usuários.
    with SessionLocal() as db:
        auth.seed_admin(db)
    if SCHEDULER_ENABLED:
        scheduler.start()  # Fase 6: roda os planos habilitados por period_seconds
    yield


# Esquema de segurança do OpenAPI/Swagger (habilita o botão "Authorize" em /docs).
# auto_error=False porque quem valida de fato é auth.guard (que libera as rotas públicas).
bearer_scheme = HTTPBearer(auto_error=False, description="Cole o access_token obtido em POST /auth/login")

app = FastAPI(
    title="UFSM Monitor Controller",
    version="0.1.0",
    lifespan=lifespan,
    dependencies=[Depends(bearer_scheme), Depends(auth.guard)],  # login exigido, exceto rotas públicas
)

# CORS para o front-end (dashboard). Em produção, restrinja via FRONTEND_ORIGINS.
_origins = ["*"] if FRONTEND_ORIGINS.strip() == "*" else [o.strip() for o in FRONTEND_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


# --------------------------------------------------------------------------
# Autenticação
# --------------------------------------------------------------------------
@app.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    auth.check_login_allowed(body.username)
    user = db.query(models.User).filter(models.User.username == body.username).first()
    if user is None or not user.active or not auth.verify_password(body.password, user.password_hash):
        auth.register_login_failure(body.username)
        raise HTTPException(status_code=401, detail="usuário ou senha inválidos")
    auth.reset_login_attempts(body.username)
    return {
        "access_token": auth.create_access_token(user),
        "refresh_token": auth.issue_refresh_token(db, user),
        "token_type": "bearer",
        "username": user.username,
        "must_change_password": user.must_change_password,
    }


@app.post("/auth/refresh")
def refresh_token(body: RefreshIn, db: Session = Depends(get_db)):
    user, new_refresh = auth.rotate_refresh_token(db, body.refresh_token)
    return {
        "access_token": auth.create_access_token(user),
        "refresh_token": new_refresh,
        "token_type": "bearer",
        "username": user.username,
        "must_change_password": user.must_change_password,
    }


@app.post("/auth/logout")
def logout(body: RefreshIn, db: Session = Depends(get_db)):
    auth.revoke_refresh_token(db, body.refresh_token)
    return {"ok": True}


@app.get("/auth/me")
def me(current: models.User = Depends(auth.get_current_user)):
    return _user_dict(current)


@app.post("/auth/change-password")
def change_password(
    body: PasswordChangeIn,
    current: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    if not auth.verify_password(body.current_password, current.password_hash):
        raise HTTPException(status_code=400, detail="senha atual incorreta")
    if len(body.new_password) < auth.MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"a nova senha deve ter ao menos {auth.MIN_PASSWORD_LEN} caracteres",
        )
    current.password_hash = auth.hash_password(body.new_password)
    current.must_change_password = False
    db.commit()
    auth.revoke_all_for_user(db, current.id)  # encerra as sessões antigas
    # Emite uma sessão nova para o próprio cliente que trocou a senha.
    return {
        "ok": True,
        "access_token": auth.create_access_token(current),
        "refresh_token": auth.issue_refresh_token(db, current),
        "token_type": "bearer",
        "username": current.username,
        "must_change_password": False,
    }


# --------------------------------------------------------------------------
# Usuários (gestão — papel único ADMIN)
# --------------------------------------------------------------------------
@app.get("/users")
def list_users(db: Session = Depends(get_db)):
    return [_user_dict(u) for u in db.query(models.User).all()]


@app.post("/users")
def create_user(body: UserIn, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == body.username).first():
        raise HTTPException(status_code=409, detail="nome de usuário já existe")
    if len(body.password) < auth.MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"a senha deve ter ao menos {auth.MIN_PASSWORD_LEN} caracteres",
        )
    u = models.User(
        username=body.username,
        password_hash=auth.hash_password(body.password),
        role="admin",
        must_change_password=True,
        active=True,
    )
    db.add(u)
    db.commit()
    return _user_dict(u)


@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    u = db.get(models.User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="usuário não encontrado")
    if u.id == current.id:
        raise HTTPException(status_code=400, detail="não é possível remover o próprio usuário")
    if db.query(models.User).count() <= 1:
        raise HTTPException(status_code=400, detail="não é possível remover o último usuário")
    auth.revoke_all_for_user(db, u.id)
    db.delete(u)
    db.commit()
    return {"deleted": user_id}


@app.get("/scheduler/status")
def scheduler_status():
    return {"enabled": SCHEDULER_ENABLED, "last_runs": scheduler.status()}


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
# Gestão (remoção / habilitar-desabilitar) — dá mais controle ao dashboard
# --------------------------------------------------------------------------
@app.delete("/probes/{probe_id}")
def delete_probe(probe_id: str, db: Session = Depends(get_db)):
    p = db.get(models.Probe, probe_id)
    if p is None:
        raise HTTPException(status_code=404, detail="probe não encontrado")
    db.delete(p)
    db.commit()
    return {"deleted": probe_id}


@app.delete("/targets/{target_id}")
def delete_target(target_id: int, db: Session = Depends(get_db)):
    t = db.get(models.Target, target_id)
    if t is None:
        raise HTTPException(status_code=404, detail="destino não encontrado")
    db.delete(t)
    db.commit()
    return {"deleted": target_id}


@app.delete("/groups/{name}")
def delete_group(name: str, db: Session = Depends(get_db)):
    g = db.get(models.Group, name)
    if g is None:
        raise HTTPException(status_code=404, detail="grupo não encontrado")
    db.delete(g)
    db.commit()
    return {"deleted": name}


@app.delete("/plans/{plan_id}")
def delete_plan(plan_id: str, db: Session = Depends(get_db)):
    row = db.get(models.Plan, plan_id)
    if row is None:
        raise HTTPException(status_code=404, detail="plano não encontrado")
    db.delete(row)
    db.commit()
    return {"deleted": plan_id}


def _set_plan_enabled(plan_id: str, enabled: bool, db: Session):
    row = db.get(models.Plan, plan_id)
    if row is None:
        raise HTTPException(status_code=404, detail="plano não encontrado")
    row.enabled = enabled
    db.commit()
    return {"plan_id": plan_id, "enabled": enabled}


@app.post("/plans/{plan_id}/enable")
def enable_plan(plan_id: str, db: Session = Depends(get_db)):
    return _set_plan_enabled(plan_id, True, db)


@app.post("/plans/{plan_id}/disable")
def disable_plan(plan_id: str, db: Session = Depends(get_db)):
    return _set_plan_enabled(plan_id, False, db)


# --------------------------------------------------------------------------
# Leitura de dados para o dashboard (séries, matriz, status, visão geral)
# --------------------------------------------------------------------------
@app.get("/stats/overview")
def stats_overview(db: Session = Depends(get_db)):
    counts = {
        "probes": db.query(models.Probe).count(),
        "probes_active": db.query(models.Probe).filter(models.Probe.active.is_(True)).count(),
        "targets": db.query(models.Target).count(),
        "groups": db.query(models.Group).count(),
        "plans": db.query(models.Plan).count(),
        "plans_enabled": db.query(models.Plan).filter(models.Plan.enabled.is_(True)).count(),
        "tasks_published": db.query(models.TaskInstance).count(),
    }
    return {
        "counts": counts,
        "runs": analytics.run_stats(24),
        "scheduler": {"enabled": SCHEDULER_ENABLED, "last_runs": scheduler.status()},
    }


@app.get("/measurements/fields")
def measurements_fields():
    return analytics.known_fields()


@app.get("/measurements/recent")
def measurements_recent(limit: int = 50):
    return analytics.recent(limit)


@app.get("/measurements/series")
def measurements_series(
    type: str,
    field: str = "",
    probe_id: str = "",
    target: str = "",
    hours: int = 24,
    limit: int = 2000,
):
    return analytics.series(type, field or None, probe_id or None, target or None, hours, limit)


@app.get("/measurements/matrix")
def measurements_matrix(type: str = "icmp", hours: int = 24):
    return analytics.matrix(type, hours)


@app.get("/measurements/traceroute")
def measurements_traceroute(probe_id: str = "", target: str = "", limit: int = 20):
    return analytics.traceroute_recent(probe_id or None, target or None, limit)


@app.get("/probes/status")
def probes_status(minutes: int = 30, db: Session = Depends(get_db)):
    activity = {a["probe_id"]: a for a in analytics.probe_activity(minutes)}
    out = []
    for p in db.query(models.Probe).all():
        a = activity.get(p.probe_id, {})
        runs = a.get("runs", 0)
        ok = a.get("ok", 0)
        out.append({
            **_probe_dict(p),
            "last_seen": a.get("last_seen"),
            "runs_recent": runs,
            "ok_recent": ok,
            "success_rate": round(ok / runs, 3) if runs else None,
            "online": bool(a.get("last_seen")),
        })
    return out


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


def _user_dict(u: models.User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "active": u.active,
        "must_change_password": u.must_change_password,
    }
