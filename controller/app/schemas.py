"""Schemas Pydantic: entrada da API e o plano declarativo (espelha contracts/)."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

MeasurementType = Literal["icmp", "iperf3", "dns", "http", "traceroute"]


class ProbeIn(BaseModel):
    probe_id: str
    hostname: str = ""
    address: str = ""
    deployment: str = ""
    vlan: str = ""
    active: bool = True


class TargetIn(BaseModel):
    name: str
    kind: Literal["external", "probe"] = "external"
    address: str


class GroupIn(BaseModel):
    name: str
    members: list[str] = Field(default_factory=list)


class Job(BaseModel):
    id: str
    type: MeasurementType
    sources: list[str]  # "group:<nome>", "probe:<id>" ou "<probe_id>"
    targets: list[str]  # "group:<nome>", "probe:<id>" ou endereço externo
    exclude_self: bool = False
    period_seconds: int = 300
    # Parâmetros opcionais por tipo (defaults aplicados na expansão):
    samples: Optional[int] = None
    timeout_ms: Optional[int] = None
    duration_seconds: Optional[int] = None
    reverse: Optional[bool] = None
    qtype: Optional[str] = None
    resolver: Optional[str] = None
    tcp: Optional[bool] = None
    method: Optional[str] = None
    cycles: Optional[int] = None
    max_hops: Optional[int] = None


class Plan(BaseModel):
    plan_id: str
    revision: int = 1
    enabled: bool = False
    groups: dict[str, list[str]] = Field(default_factory=dict)
    jobs: list[Job]
