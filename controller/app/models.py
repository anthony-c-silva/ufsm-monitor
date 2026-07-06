"""Modelos ORM: entidades administrativas (fonte de verdade no PostgreSQL)."""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String, JSON

from .db import Base


def utcnow():
    return datetime.now(timezone.utc)


class Probe(Base):
    __tablename__ = "probes"
    probe_id = Column(String, primary_key=True)
    hostname = Column(String, default="")
    address = Column(String, default="")  # IP/host para medições probe->probe
    deployment = Column(String, default="")
    vlan = Column(String, default="")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    last_seen = Column(DateTime(timezone=True), default=utcnow)


class Target(Base):
    """Allowlist de destinos externos autorizados (spec 12)."""
    __tablename__ = "targets"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True)
    kind = Column(String, default="external")  # external | probe
    address = Column(String, index=True)  # URL / host / IP
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Group(Base):
    __tablename__ = "groups"
    name = Column(String, primary_key=True)
    members = Column(JSON, default=list)  # lista de probe_id
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Plan(Base):
    __tablename__ = "plans"
    plan_id = Column(String, primary_key=True)
    revision = Column(Integer, default=1)
    enabled = Column(Boolean, default=False)
    spec = Column(JSON)  # o plano JSON completo (grupos + jobs)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class TaskInstance(Base):
    """Auditoria das tarefas geradas/publicadas."""
    __tablename__ = "task_instances"
    task_id = Column(String, primary_key=True)
    plan_id = Column(String, index=True)
    plan_revision = Column(Integer, default=1)
    job_id = Column(String)
    type = Column(String)
    source_probe = Column(String, index=True)
    target = Column(String)
    target_probe = Column(String, default="")
    created_at = Column(DateTime(timezone=True), default=utcnow)
    published_at = Column(DateTime(timezone=True), nullable=True)
