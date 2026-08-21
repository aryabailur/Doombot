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
import logging
import time

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from api import runner, ws
from api.schemas import (
    CreateInvestigationRequest,
    Escalation,
    Evidence,
    InvestigationDetail,
    InvestigationSummary,
    StepRecord,
)
from memory import repo

logger = logging.getLogger(__name__)

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
    """Start investigating a repository's open issues. Returns immediately.

    The dashboard could select a repository but had no way to make the agent
    look at it: POST /api/investigations needs a specific issue number, and
    nothing in the UI knew which numbers existed.

    Listing the issues is deliberately *not* awaited here. It is a GitHub round
    trip, and under a secondary rate limit PyGithub backs off for minutes --
    measured at 85s for a four-issue repository, all of it with the Analyse
    button spinning. The caller now gets an answer in milliseconds and watches
    the run arrive over the WebSocket, which is where the progress belongs.

    Only the repository's existence is checked synchronously, because that is
    one cheap request and it is the difference between "started" and a typo
    that would otherwise fail silently in the background.
    """
    repo_name = f"{owner}/{repo_slug}"

    from mcp_server.github_client import _get_client

    try:
        await asyncio.to_thread(lambda: _get_client().get_repo(repo_name).full_name)
    except Exception as exc:
        status, detail = _github_error_detail(exc)
        raise HTTPException(status_code=status, detail=detail) from exc

    background.add_task(_scan_and_queue, repo_name, limit)
    return {"repo_name": repo_name, "status": "scanning", "limit": limit}


async def _scan_and_queue(repo_name: str, limit: int) -> None:
    """Fetch open issues and run the graph on each, one at a time.

    Sequential rather than concurrent: each investigation is several Groq calls,
    and firing five at once is the fastest way to hit a model rate limit and
    fail all of them. One at a time also makes the live trace readable, which is
    the point of streaming it.
    """
    from mcp_server.github_client import get_issues

    try:
        issues = await asyncio.to_thread(get_issues, repo_name, "open", limit)
    except Exception as exc:
        logger.warning("scan: could not list issues for %s: %s", repo_name, exc)
        await ws.broadcast({
            "type": "activity",
            "data": {"message": f"Could not read issues for {repo_name}"},
        })
        return

    already = {
        row["number"]
        for row in repo.list_investigations()
        if row["repo_name"] == repo_name
    }
    pending = [
        issue["number"]
        for issue in issues
        if issue.get("number") is not None and issue["number"] not in already
    ]

    # `queued` is structured so the UI can count in-flight work without
    # parsing the message string.
    await ws.broadcast({
        "type": "activity",
        "data": {
            "repo_name": repo_name,
            "queued": len(pending),
            "message": (
                f"Scanning {repo_name}: {len(pending)} issue(s) to investigate"
                if pending
                else f"{repo_name}: nothing new to investigate"
            ),
        },
    })

    for index, number in enumerate(pending, start=1):
        # Per-issue progress, so the UI can show "3 of 5" rather than a
        # spinner that gives no sense of how much is left.
        await ws.broadcast({
            "type": "pipeline",
            "data": {
                "stage": "investigate",
                "status": "running",
                "repo_name": repo_name,
                "message": f"Investigating #{number}",
                "index": index,
                "total": len(pending),
                "issue_number": number,
            },
        })
        await runner.run_investigation(
            runner.new_investigation_id(), repo_name, "issue", number
        )


def _github_error_detail(exc: Exception) -> tuple[int, str]:
    """Map a GitHub failure onto a status and a message worth reading.

    A rate limit is not a server error and must not read like one: it is
    temporary, it has a known end time, and the only useful response is to say
    when to try again. Anything else keeps its own wording.
    """
    from github import GithubException

    if type(exc).__name__ == "RateLimitExceededException":
        reset = ""
        try:
            from mcp_server.github_client import _get_client

            core = _get_client().get_rate_limit().resources.core
            minutes = max(
                0, int((core.reset.timestamp() - time.time()) // 60)
            )
            reset = f" Resets in about {minutes} minute(s)."
        except Exception:
            pass
        return 429, (
            "GitHub API quota exhausted for this token." + reset
        )

    if isinstance(exc, GithubException) and exc.status == 404:
        return 404, "No such repository, or the token cannot see it."

    return 502, f"could not read repository: {exc}"


@router.post("/api/repos/{owner}/{repo_slug}/onboard")
async def onboard_repository(
    owner: str,
    repo_slug: str,
    background: BackgroundTasks,
    limit: int = Query(default=5, ge=1, le=25),
) -> dict:
    """Run the whole add-a-repository pipeline, narrating each stage.

    Adding a repository used to be three silent calls -- validate, embed,
    investigate -- with nothing on screen between the click and, half a minute
    later, some numbers. The work was real and completely invisible, which read
    as either broken or fake.

    This is the same work with the stages announced over the WebSocket as they
    actually start and finish, so the UI can show what is happening instead of
    guessing. Every stage event is emitted from the point where that work really
    begins; none of it is theatre on a timer.
    """
    repo_name = f"{owner}/{repo_slug}"

    from mcp_server.github_client import _get_client

    await _stage("connect", "running", repo_name, "Reaching the repository")
    try:
        full_name = await asyncio.to_thread(
            lambda: _get_client().get_repo(repo_name).full_name
        )
    except Exception as exc:
        status, detail = _github_error_detail(exc)
        await _stage("connect", "error", repo_name, detail)
        raise HTTPException(status_code=status, detail=detail) from exc

    await _stage("connect", "done", repo_name, f"Connected to {full_name}")
    background.add_task(_onboard_pipeline, repo_name, limit)
    return {"repo_name": repo_name, "status": "onboarding", "limit": limit}


async def _stage(
    stage: str, status: str, repo_name: str, message: str, extra: dict | None = None
) -> None:
    """Broadcast one pipeline stage transition."""
    await ws.broadcast({
        "type": "pipeline",
        "data": {
            "stage": stage,
            "status": status,
            "repo_name": repo_name,
            "message": message,
            **(extra or {}),
        },
    })


async def _onboard_pipeline(repo_name: str, limit: int) -> None:
    """Embed the backlog, then investigate it, narrating both."""
    from rag.embedder import index_issues

    await _stage("index", "running", repo_name, "Embedding the issue backlog")
    indexed = 0
    try:
        # 120, not 200. Every indexed issue is GitHub request budget, and the
        # 5000/hour quota is shared with investigations, health, and the graph
        # -- exhausting it on embedding takes the whole app down for an hour,
        # which is exactly what happened during testing. 120 is still a
        # substantial corpus for duplicate detection, and it is the recent
        # issues that duplicate triage actually compares against.
        indexed = await asyncio.to_thread(index_issues, repo_name, "all", 120)
    except Exception as exc:
        logger.warning("onboard: indexing failed for %s: %s", repo_name, exc)
        await _stage("index", "error", repo_name, "Could not embed the backlog")
    else:
        await _stage(
            "index",
            "done",
            repo_name,
            f"Embedded {indexed} issue(s) into the vector store",
            {"indexed": indexed},
        )

    await _stage("scan", "running", repo_name, "Selecting issues to investigate")
    await _scan_and_queue(repo_name, limit)
    await _stage("scan", "done", repo_name, "Investigations complete")


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
        proposed_action=repo.get_investigation_action(investigation_id),
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
