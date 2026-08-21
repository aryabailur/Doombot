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


class SkippedLanguage(BaseModel):
    """An extension present in the repository that the parser does not read."""

    extension: str
    files: int


class CodeGraphStats(BaseModel):
    node_count: int
    link_count: int
    cluster_count: int
    clusters: list[str]
    languages: list[str]
    attribution: str
    # Why an empty graph is empty. Defaulted, so an older payload validates.
    skipped_languages: list[SkippedLanguage] = []


class CodeGraphResponse(BaseModel):
    repository: str
    nodes: list[CodeGraphNode]
    links: list[CodeGraphLink]
    stats: CodeGraphStats
    impact: CodeGraphImpact
    # Additive, defaulted: every source file the build read, so the explorer's
    # file tree can list files that parsed to zero symbols. Defaulted so an
    # older payload still validates.
    files: list[str] = []


class SourceFileResponse(BaseModel):
    """One repository file, read on demand for the code explorer's code pane."""

    path: str
    content: str
    lines: int
    language: str
    truncated: bool


# ---------------------------------------------------------------------------
# Semantic search. Natural-language query in, real indexed issues out.
# ---------------------------------------------------------------------------


class SearchIntent(BaseModel):
    """How the query was read. Returned so the UI can show its own reasoning.

    `understood` is false when query understanding was unavailable and only the
    literal text was searched -- without it, a date filter that never ran looks
    identical to one that found nothing.
    """

    semantic_query: str
    state: str | None = None
    created_after: str | None = None
    created_before: str | None = None
    labels: list[str] = []
    author: str | None = None
    unanswered: bool = False
    min_reactions: int | None = None
    sort: str = "relevance"
    understood: bool = False
    note: str = ""


class SearchAgentContext(BaseModel):
    """What the triage agent already concluded about this issue, if anything."""

    investigation_id: str | None = None
    decision: str | None = None
    confidence: float | None = None
    status: str | None = None


class SearchResult(BaseModel):
    """One real issue. Every field comes from the index, none is generated."""

    number: int | None
    title: str
    state: str
    labels: list[str] = []
    author: str
    created_at: str
    comments: int
    reactions: int
    # Cosine similarity to the semantic query, 0-1.
    score: float
    # The passage of the body most related to the query, chosen by word overlap.
    snippet: str
    # Similarity blended with recency, engagement and agent confidence.
    rank_score: float = 0.0
    agent: SearchAgentContext | None = None


class SearchStats(BaseModel):
    """How the search was executed, so a thin result set can be explained."""

    considered: int
    returned: int
    # "in_query" when every filter ran inside the Chroma query;
    # "post_filtered_dates" when the collection predates `created_ts` and the
    # date window had to be applied to an over-fetched candidate set.
    filter_mode: str
    indexed: int
    # Hits that matched the filters but scored below the relevance floor.
    # Reported so a short list is not mistaken for a small index.
    below_floor: int = 0


class SearchResponse(BaseModel):
    repo_name: str
    query: str
    intent: SearchIntent
    results: list[SearchResult]
    stats: SearchStats


# ---------------------------------------------------------------------------
# Auto-fix pull requests. Additive: no existing model changes, so no frontend
# mirror is invalidated and the contract freeze in root CLAUDE.md 7 holds.
# ---------------------------------------------------------------------------


class AutoFixResponse(BaseModel):
    """The outcome of replaying a known fix onto the current codebase.

    `reason` is always populated, including on success, and is the field a UI
    should show. Every non-`opened` status is a *correct* answer the agent
    reached on purpose -- the patch no longer applies, the diff spans too many
    files, writes are disabled -- and collapsing those into "failed" would hide
    the one piece of information the maintainer actually wants.

    `status` values:
      opened          a draft pull request was created
      existing        one was already open for this issue; nothing was written
      not_applicable  a guardrail refused the patch; see reason
      blocked         writes are disabled (DEMO_MODE, or auto-fix not enabled)
      no_source_pr    no past fix was found to replay
      error           the attempt failed; see reason
    """

    status: Literal[
        "opened", "existing", "not_applicable", "blocked", "no_source_pr", "error"
    ]
    reason: str
    source_pr: int | None = None
    pr_number: int | None = None
    pr_url: str | None = None
    branch: str | None = None
    file: str | None = None
    changed_lines: int = 0
    # Whether the repository runs CI on pull requests, so the caller can say
    # "check the test results" rather than implying Doombot verified anything.
    ci: bool = False
    commented: bool = False
