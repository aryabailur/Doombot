"""Investigation endpoints and the graph runner.

    POST /api/investigations        -> {investigation_id}, runs graph in background
    GET  /api/investigations        -> list
    GET  /api/investigations/{id}   -> detail + steps (replayed from SQLite)
    GET  /api/escalations           -> escalation queue

FIXTURE PHASE (api/CLAUDE.md §2): every route below returns a hardcoded
fixture instance of the correct Pydantic model. The real LangGraph runner
(api/CLAUDE.md §7) is a later pass — do not wire it here yet:

    async for mode, chunk in issue_app.astream(init, stream_mode=["custom", "updates"]):
        if mode == "custom":
            repo.insert_step(chunk["data"])
            await ws.broadcast(chunk)
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from api.schemas import (
    CreateInvestigationRequest,
    Escalation,
    Evidence,
    InvestigationDetail,
    InvestigationSummary,
    StepRecord,
)

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(dt: datetime) -> str:
    return dt.isoformat()


@router.post("/api/investigations")
async def create_investigation(payload: CreateInvestigationRequest) -> dict:
    """Fixture phase: just mint an id, no background graph run yet."""
    investigation_id = str(uuid.uuid4())
    return {"investigation_id": investigation_id}


@router.get("/api/investigations", response_model=list[InvestigationSummary])
async def list_investigations() -> list[InvestigationSummary]:
    now = datetime.now(timezone.utc)
    fixtures = [
        InvestigationSummary(
            investigation_id="inv-fixture-003",
            repo_name="octocat/Hello-World",
            kind="issue",
            number=42,
            title="Memory leak when parsing large payloads",
            status="running",
            decision=None,
            created_at=_iso(now - timedelta(minutes=2)),
            completed_at=None,
        ),
        InvestigationSummary(
            investigation_id="inv-fixture-002",
            repo_name="octocat/Hello-World",
            kind="pr",
            number=17,
            title="Add retry/backoff to webhook dispatcher",
            status="done",
            decision="approve",
            created_at=_iso(now - timedelta(hours=3)),
            completed_at=_iso(now - timedelta(hours=2, minutes=50)),
        ),
        InvestigationSummary(
            investigation_id="inv-fixture-001",
            repo_name="octocat/Spoon-Knife",
            kind="issue",
            number=9,
            title="Duplicate of #3: crash on empty input",
            status="done",
            decision="close_as_duplicate",
            created_at=_iso(now - timedelta(days=1)),
            completed_at=_iso(now - timedelta(days=1) + timedelta(minutes=6)),
        ),
    ]
    return fixtures


@router.get("/api/investigations/{investigation_id}", response_model=InvestigationDetail)
async def get_investigation(investigation_id: str) -> InvestigationDetail:
    """Fixture phase: always returns the same fixture regardless of the
    requested id — no real lookup yet."""
    now = datetime.now(timezone.utc)
    started = now - timedelta(minutes=6)

    step1_start = started
    step1_end = step1_start + timedelta(seconds=4)
    step2_start = step1_end
    step2_end = step2_start + timedelta(seconds=9)
    step3_start = step2_end
    step3_end = step3_start + timedelta(seconds=3)

    steps = [
        StepRecord(
            step_id="step-1",
            investigation_id=investigation_id,
            seq=1,
            name="fetch_context",
            title="Fetch issue context",
            status="done",
            input_summary="issue #42 in octocat/Hello-World",
            output_summary="Loaded issue body, 6 comments, 2 linked PRs",
            evidence=[
                Evidence(
                    type="file",
                    ref="src/parser/stream.py",
                    score=0.82,
                    snippet="def parse_chunk(buf): ...  # unbounded buffer growth",
                ),
            ],
            duration_ms=4000,
            started_at=_iso(step1_start),
            ended_at=_iso(step1_end),
        ),
        StepRecord(
            step_id="step-2",
            investigation_id=investigation_id,
            seq=2,
            name="search_duplicates",
            title="Search for duplicate issues",
            status="done",
            input_summary="embedding query over open issues",
            output_summary="Found 1 related issue with 0.74 similarity, not a strict duplicate",
            evidence=[
                Evidence(
                    type="duplicate",
                    ref="#31",
                    score=0.74,
                    snippet="Issue #31: 'High memory usage during import' — related but distinct root cause",
                ),
                Evidence(
                    type="security",
                    ref="CVE-2023-xxxxx",
                    score=0.41,
                    snippet="Low-confidence match against known unbounded-buffer advisory",
                ),
            ],
            duration_ms=9000,
            started_at=_iso(step2_start),
            ended_at=_iso(step2_end),
        ),
        StepRecord(
            step_id="step-3",
            investigation_id=investigation_id,
            seq=3,
            name="decide",
            title="Synthesize decision",
            status="running",
            input_summary="context + duplicate search results",
            output_summary="",
            evidence=[],
            duration_ms=3000,
            started_at=_iso(step3_start),
            ended_at=None,
        ),
    ]

    return InvestigationDetail(
        investigation_id=investigation_id,
        repo_name="octocat/Hello-World",
        kind="issue",
        number=42,
        title="Memory leak when parsing large payloads",
        status="running",
        decision=None,
        created_at=_iso(started),
        completed_at=None,
        steps=steps,
        decision_reason=(
            "Buffer in parse_chunk grows unbounded on large payloads; related to #31 "
            "but distinct enough to track separately. Recommend triage as bug, high priority."
        ),
        confidence=0.78,
        impact_score=0.63,
    )


@router.get("/api/escalations", response_model=list[Escalation])
async def list_escalations() -> list[Escalation]:
    now = datetime.now(timezone.utc)
    fixtures = [
        Escalation(
            investigation_id="inv-fixture-003",
            reason="Potential memory-safety issue with no assigned owner for 48h",
            severity="high",
            number=42,
            title="Memory leak when parsing large payloads",
            created_at=_iso(now - timedelta(minutes=1)),
        ),
        Escalation(
            investigation_id="inv-fixture-002",
            reason="PR touches auth middleware; flagged for manual security review",
            severity="medium",
            number=17,
            title="Add retry/backoff to webhook dispatcher",
            created_at=_iso(now - timedelta(hours=2, minutes=55)),
        ),
        Escalation(
            investigation_id="inv-fixture-001",
            reason="Low-confidence duplicate classification (score 0.74) requires human confirmation",
            severity="low",
            number=9,
            title="Duplicate of #3: crash on empty input",
            created_at=_iso(now - timedelta(days=1) + timedelta(minutes=6)),
        ),
    ]
    return fixtures
