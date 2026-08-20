"""Pydantic models — THE contract between backend and frontend.

Exact field names and types. Do not rename or add fields without following
the breaking-change process in api/CLAUDE.md §2.
"""
from typing import Literal

from pydantic import BaseModel


class Evidence(BaseModel):
    # Closed union, matching agents/CLAUDE.md 3.6 -- these four are what the
    # agent actually emits, and the dashboard's EvidenceCard keys a map on
    # exactly them.
    type: Literal["issue", "pr", "file", "rule"]
    ref: str
    # Nullable. Rule-type evidence (a matched security keyword, a threshold
    # note) has no meaningful score, and the agent sends None rather than a
    # misleading 0.0. Declaring this `float` made every replay of a real
    # investigation 500 -- the fixture data happened to always carry a score,
    # so it only surfaced once the graph runner wrote genuine steps.
    score: float | None
    snippet: str


class StepRecord(BaseModel):
    step_id: str
    investigation_id: str
    seq: int
    name: str
    title: str
    status: Literal["running", "done", "error"]
    input_summary: str
    output_summary: str
    evidence: list[Evidence]
    duration_ms: int
    started_at: str
    ended_at: str | None


class InvestigationSummary(BaseModel):
    investigation_id: str
    repo_name: str
    kind: Literal["issue", "pr"]
    number: int
    title: str
    status: str
    decision: str | None
    created_at: str
    completed_at: str | None


class InvestigationDetail(InvestigationSummary):
    steps: list[StepRecord]
    decision_reason: str | None
    confidence: float | None
    impact_score: float | None


class Escalation(BaseModel):
    investigation_id: str
    reason: str
    severity: str
    number: int
    title: str
    created_at: str


class HealthBreakdown(BaseModel):
    security: float
    staleness: float
    duplication: float
    responsiveness: float


class HealthPoint(BaseModel):
    ts: str
    score: float


class HealthResponse(BaseModel):
    score: float
    breakdown: HealthBreakdown
    history: list[HealthPoint]


class RepoSummary(BaseModel):
    repo_name: str
    health_score: float
    open_investigations: int
    last_scan: str | None


class CreateInvestigationRequest(BaseModel):
    repo_name: str
    kind: Literal["issue", "pr"]
    number: int


class FeedbackRequest(BaseModel):
    investigation_id: str
    step_id: str | None = None
    verdict: Literal["up", "down"]
    note: str | None = None


class BriefResponse(BaseModel):
    markdown: str
    generated_at: str


class IndexJobResponse(BaseModel):
    job_id: str
    status: str


class GraphNode(BaseModel):
    id: str
    number: int
    title: str
    category: Literal["security", "duplicate", "stale", "resolved", "open"]
    state: str
    labels: list[str]
    engagement: int
    escalated: bool


class GraphLink(BaseModel):
    source: str
    target: str
    kind: Literal["duplicate", "similar", "reference", "metadata"]
    score: float
    why: str


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    links: list[GraphLink]
    stats: dict


class CodeGraphNode(BaseModel):
    id: str
    qualname: str
    symbol_name: str
    file_path: str
    kind: str
    runtime: str
    language: str
    start_line: int
    end_line: int
    cluster_label: str
    in_degree: int
    out_degree: int
    hub_score: float
    x2d: float
    y2d: float
    x3d: float
    y3d: float
    z3d: float
    impact_status: Literal["changed", "ripple", "unaffected"]
    impact_distance: int | None


class CodeGraphLink(BaseModel):
    source: str
    target: str
    edge_type: Literal["calls", "renders", "http_calls"]
    why: str


class CodeGraphImpactedUnit(BaseModel):
    qualname: str
    distance: int
    edge_type: Literal["calls", "renders", "http_calls"]


class CodeGraphClusterImpact(BaseModel):
    cluster: str
    impact_score: float
    changed_count: int
    ripple_count: int
    total_count: int


class CodeGraphImpact(BaseModel):
    risk_level: Literal["low", "medium", "high", "critical"]
    changed_units: list[str]
    impacted_units: list[CodeGraphImpactedUnit]
    cluster_impact: list[CodeGraphClusterImpact]
    suggested_labels: list[str]


class CodeGraphStats(BaseModel):
    node_count: int
    link_count: int
    cluster_count: int
    clusters: list[str]
    languages: list[str]
    attribution: str


class CodeGraphResponse(BaseModel):
    repository: str
    nodes: list[CodeGraphNode]
    links: list[CodeGraphLink]
    stats: CodeGraphStats
    impact: CodeGraphImpact
