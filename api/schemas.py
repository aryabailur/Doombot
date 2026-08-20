"""Pydantic models — THE contract between backend and frontend.

Exact field names and types. Do not rename or add fields without following
the breaking-change process in api/CLAUDE.md §2.
"""
from typing import Literal

from pydantic import BaseModel


class Evidence(BaseModel):
    type: str
    ref: str
    score: float
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
