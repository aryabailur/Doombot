"""Investigation endpoints and the graph runner.

    POST /api/investigations              -> {investigation_id}, runs the graph in background
    POST /api/repos/{owner}/{repo}/scan   -> investigate a repo's open issues
    GET  /api/investigations              -> list, newest first, ?repo_name= to scope
    GET  /api/investigations/{id}         -> detail + steps replayed from SQLite
    GET  /api/escalations                 -> escalation queue, ?repo_name= to scope

No longer the fixture phase: every route reads SQLite. The actual streaming
lives in `api/runner.py`, which fans each step to both the database and the
WebSocket hub.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from api import runner
from api.schemas import (
    CreateInvestigationRequest,
    Escalation,
    Evidence,
    InvestigationDetail,
    InvestigationSummary,
    StepRecord,
)
from memory import repo

router = APIRouter()


def _summary(row: dict) -> InvestigationSummary:
    """Map an investigations row onto the wire contract.

    The column is `id`; the contract field is `investigation_id`. Translating
    here keeps the schema stable regardless of what the table calls things --
    and getting this wrong is exactly the silent mismatch the contract tests
    exist to catch.
    """
    return InvestigationSummary(
        investigation_id=row["id"],
        repo_name=row["repo_name"],
        kind=row["kind"],
        number=row["number"],
        title=row["title"] or "",
        status=row["status"],
        decision=row.get("decision"),
        created_at=row["created_at"],
        completed_at=row.get("completed_at"),
    )


def _step(row: dict) -> StepRecord:
    raw = row.get("evidence")
    if isinstance(raw, str):
        # get_steps normally decodes this, but tolerate a raw column value so a
        # partially-written row cannot break the whole replay.
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = []

    return StepRecord(
        step_id=row["step_id"],
        investigation_id=row["investigation_id"],
        seq=row["seq"],
        name=row["name"],
        title=row["title"],
        status=row["status"],
        input_summary=row.get("input_summary") or "",
        output_summary=row.get("output_summary") or "",
        evidence=[Evidence(**item) for item in (raw or [])],
        duration_ms=row.get("duration_ms") or 0,
        started_at=row["started_at"],
        ended_at=row.get("ended_at"),
    )


@router.post("/api/investigations")
async def create_investigation(
    payload: CreateInvestigationRequest,
    background: BackgroundTasks,
) -> dict:
    """Start an investigation and return immediately.

    The graph takes ~10s of network and model calls, so it runs as a
    background task: the caller gets an id at once and follows the run over
    the WebSocket. Blocking here would make the UI look frozen for the entire
    investigation.
    """
    investigation_id = runner.new_investigation_id()
    background.add_task(
        runner.run_investigation,
        investigation_id,
        payload.repo_name,
        payload.kind,
        payload.number,
    )
    return {"investigation_id": investigation_id}


@router.post("/api/repos/{owner}/{repo_slug}/scan")
async def scan_repository(
    owner: str,
    repo_slug: str,
    background: BackgroundTasks,
    limit: int = Query(default=5, ge=1, le=25),
) -> dict:
    """Investigate a repository's open issues.

    The dashboard could select a repository but had no way to make the agent
    look at it: `POST /api/investigations` needs a specific issue number, and
    nothing in the UI knew which numbers existed. Autonomous monitoring covers
    this for repositories listed in DOOMBOT_MONITOR_REPOS, but that needs an
    env edit and a restart -- so an arbitrary repository could be added and
    then never analysed, which reads as the agent silently ignoring it.

    Bounded by `limit`, and open issues only. A full sweep of a large backlog
    would be dozens of model calls and hit Groq's rate limit long before it
    finished, so this deliberately investigates the most recent few rather
    than everything.
    """
    repo_name = f"{owner}/{repo_slug}"

    from mcp_server.github_client import get_issues

    try:
        issues = await asyncio.to_thread(get_issues, repo_name, "open", limit)
    except Exception as exc:
        # A bad name or a private repo must fail loudly here: returning an
        # empty success would look identical to "nothing needed attention".
        raise HTTPException(
            status_code=502, detail=f"could not read issues: {exc}"
        ) from exc

    already = {
        row["number"]
        for row in repo.list_investigations()
        if row["repo_name"] == repo_name
    }

    queued: list[int] = []
    for issue in issues:
        number = issue.get("number")
        if number is None or number in already:
            continue
        investigation_id = runner.new_investigation_id()
        background.add_task(
            runner.run_investigation, investigation_id, repo_name, "issue", number
        )
        queued.append(number)

    return {
        "repo_name": repo_name,
        "queued": queued,
        "skipped_already_investigated": len(issues) - len(queued),
    }


@router.get("/api/investigations", response_model=list[InvestigationSummary])
async def list_investigations(
    repo_name: str | None = Query(default=None),
) -> list[InvestigationSummary]:
    """Investigations, newest first, optionally scoped to one repository.

    The filter is optional so existing callers keep working, but the dashboard
    needs it: without it, selecting a repository left every panel showing
    another repository's investigations, which read as "it did not analyse
    my repo" when in fact it had never been asked to.
    """
    rows = repo.list_investigations()
    if repo_name:
        rows = [row for row in rows if row["repo_name"] == repo_name]
    return [_summary(row) for row in rows]


@router.get(
    "/api/investigations/{investigation_id}", response_model=InvestigationDetail
)
async def get_investigation(investigation_id: str) -> InvestigationDetail:
    """Replay one investigation, chain and all, from SQLite.

    This is what makes the trace survive a page refresh or an API restart --
    the dashboard re-reads the run rather than depending on having been
    connected while it happened.
    """
    row = repo.get_investigation(investigation_id)
    if row is None:
        # 404, never 200-with-an-empty-body: the dashboard distinguishes "not
        # found" from "found but still running", and they render differently.
        raise HTTPException(status_code=404, detail="investigation not found")

    summary = _summary(row)
    return InvestigationDetail(
        **summary.model_dump(),
        steps=[_step(step) for step in repo.get_steps(investigation_id)],
        decision_reason=row.get("decision_reason"),
        confidence=row.get("confidence"),
        impact_score=row.get("impact_score"),
    )


@router.get("/api/escalations", response_model=list[Escalation])
async def list_escalations(
    repo_name: str | None = Query(default=None),
) -> list[Escalation]:
    """Unresolved escalations, joined to their investigation for context.

    An escalation row alone has no issue number or title -- both live on the
    investigation -- and the queue is unreadable without them.
    """
    items: list[Escalation] = []
    for row in repo.list_escalations(resolved=False):
        investigation = repo.get_investigation(row["investigation_id"]) or {}
        # Scoping happens here rather than in SQL because the repository name
        # lives on the investigation, not on the escalation row.
        if repo_name and investigation.get("repo_name") != repo_name:
            continue
        items.append(
            Escalation(
                investigation_id=row["investigation_id"],
                reason=row["reason"],
                severity=row["severity"],
                number=investigation.get("number", 0),
                title=investigation.get("title") or "",
                created_at=row["created_at"],
            )
        )
    return items
