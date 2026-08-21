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


ActionStatus = Literal[
    "proposed", "approved", "rejected", "executing", "verified", "failed"
]


class ProposedAction(BaseModel):
    id: str
    investigation_id: str
    repo_name: str
    issue_number: int
    action: str
    comment: str | None
    labels: list[str]
    status: ActionStatus
    decided_by: str | None
    decision_note: str | None
    result: dict | None
    error: str | None
    created_at: str
    decided_at: str | None
    executed_at: str | None


class InvestigationDetail(InvestigationSummary):
    steps: list[StepRecord]
    decision_reason: str | None
    confidence: float | None
    impact_score: float | None
    proposed_action: ProposedAction | None = None


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
    # Additive, defaulted: a repository with no issues has no measured health,
    # and three of the four sub-scores return 100 for an empty backlog. Without
    # this the dashboard showed a confident 100/100 for a repo it had never
    # been able to read. Defaults keep every existing caller valid.
    measured: bool = True
    issue_count: int = 0
    # True when the issues could not be read at all (rate limit, network,
    # permissions) -- distinct from a repository that genuinely has none.
    unreadable: bool = False


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


class ActionDecisionRequest(BaseModel):
    approved: bool
    decided_by: str
    note: str | None = None


PolicyGuidance = Literal["observing", "caution", "mixed", "aligned"]


class ActionPolicyProfile(BaseModel):
    action: str
    samples: int
    approvals: int
    rejections: int
    approval_rate: float
    guidance: PolicyGuidance


class LabelPolicyProfile(BaseModel):
    label: str
    samples: int
    approvals: int
    rejections: int
    approval_rate: float
    guidance: PolicyGuidance


class RepositoryPolicy(BaseModel):
    repo_name: str
    mode: Literal["observing", "learned"]
    minimum_samples: int
    total_decisions: int
    approvals: int
    rejections: int
    approval_rate: float | None
    actions: list[ActionPolicyProfile]
    labels: list[LabelPolicyProfile]
    learned_rules: list[str]
    updated_at: str | None


FixRunStatus = Literal[
    "queued", "preparing", "generating", "verifying", "proposed", "failed",
    "approved", "rejected", "publishing", "published",
]


class CreateFixRunRequest(BaseModel):
    investigation_id: str


class FixReceipt(BaseModel):
    command: list[str]
    exit_code: int
    duration_ms: int
    stdout: str
    stderr: str
    containerized: bool
    network_disabled: bool
    image: str
    image_digest: str


class FixRun(BaseModel):
    id: str
    investigation_id: str
    repo_name: str
    issue_number: int
    status: FixRunStatus
    base_sha: str | None
    summary: str | None
    patch_diff: str | None
    commands: list[list[str]]
    receipts: list[FixReceipt]
    error: str | None
    decided_by: str | None
    decision_note: str | None
    created_at: str
    updated_at: str
    decided_at: str | None
    published_at: str | None


class FixDecisionRequest(BaseModel):
    approved: bool
    decided_by: str
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
