"""Investigation endpoints and the graph runner.

    POST /api/investigations        -> {investigation_id}, runs graph in background
    GET  /api/investigations        -> list
    GET  /api/investigations/{id}   -> detail + steps (replayed from SQLite)
    GET  /api/escalations           -> escalation queue

The POST handler kicks off the issue-triage LangGraph in a background
task and streams its custom-mode output through one loop that both
persists each step to SQLite and broadcasts it over the WebSocket hub —
the single write site described in api/CLAUDE.md §7.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException

from api import ws
from api.schemas import (
    ApproveActionResponse,
    CreateInvestigationRequest,
    Escalation,
    InvestigationDetail,
    InvestigationSummary,
    SuggestedAction,
)
from agents.triage_graph import issue_app
from mcp_server.client import call_tool_sync
from mcp_server.tool_names import ADD_LABELS, POST_ISSUE_COMMENT
from memory import repo

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


SECURITY_LABEL = "security-sensitive"


def _record_suggested_labels(
    investigation_id: str, repo_name: str, issue_number: int, step: dict
) -> None:
    """labeler emits one evidence item per label candidate, snippet
    'applied' (auto-sent to GitHub), 'apply_failed' (attempted, API call
    errored), or 'suggested' (held back for a human — either below the
    auto-apply threshold, or the security label, which always requires
    approval regardless of confidence per docs/DESIGN.md §12). Turn the
    suggested ones into an approvable action so they're not silently
    dropped on the floor."""
    suggested = [
        item for item in step.get("evidence", []) if item.get("snippet") == "suggested"
    ]
    if not suggested:
        return
    labels = [item["ref"] for item in suggested]
    confidence = max((item.get("score") or 0.0) for item in suggested)
    if SECURITY_LABEL in labels:
        reason = "Security-sensitive labels always require maintainer approval before publishing"
    else:
        reason = f"Confidence below the {int(0.85 * 100)}% auto-apply threshold"
    repo.create_suggested_action(
        action_id=str(uuid.uuid4()),
        investigation_id=investigation_id,
        repo_name=repo_name,
        number=issue_number,
        kind="add_labels",
        payload={"labels": labels},
        reason=reason,
        confidence=confidence,
    )


async def _run_investigation(investigation_id: str, repo_name: str, issue_number: int) -> None:
    init = {
        "repo_name": repo_name,
        "issue_number": issue_number,
        "investigation_id": investigation_id,
    }
    decision = None
    title_set = False
    try:
        async for mode, chunk in issue_app.astream(init, stream_mode=["custom", "updates"]):
            if mode == "custom":
                step = chunk["data"]
                repo.insert_step(step)
                if step.get("name") == "labeler" and step.get("status") == "done":
                    _record_suggested_labels(investigation_id, repo_name, issue_number, step)
                await ws.broadcast(chunk)
            elif mode == "updates":
                for node_output in chunk.values():
                    if not isinstance(node_output, dict):
                        continue
                    if "decision" in node_output:
                        decision = node_output["decision"]
                    if not title_set and "issue_metadata" in node_output:
                        real_title = node_output["issue_metadata"].get("title")
                        if real_title:
                            repo.update_investigation_title(investigation_id, real_title)
                            title_set = True

        if decision:
            repo.complete_investigation(
                investigation_id,
                decision=decision.get("action", "unknown"),
                decision_reason=decision.get("reason", ""),
                confidence=decision.get("confidence", 0.0),
                impact_score=0.0,
            )
            if decision.get("action") == "escalate":
                repo.create_escalation(
                    investigation_id=investigation_id,
                    repo_name=repo_name,
                    reason=decision.get("reason", ""),
                    severity="high" if decision.get("confidence", 0) >= 0.8 else "medium",
                )
        else:
            repo.complete_investigation(
                investigation_id, decision="unknown", decision_reason="", confidence=0.0, impact_score=0.0
            )

        await ws.broadcast(
            {
                "type": "investigation.completed",
                "data": {
                    "investigation_id": investigation_id,
                    "decision": decision.get("action") if decision else "unknown",
                    "health_delta": 0,
                },
            }
        )
    except Exception as e:
        repo.complete_investigation(
            investigation_id, decision="error", decision_reason=str(e), confidence=0.0, impact_score=0.0
        )


@router.post("/api/investigations")
async def create_investigation(
    payload: CreateInvestigationRequest, background_tasks: BackgroundTasks
) -> dict:
    existing = repo.find_recent_open_investigation(
        payload.repo_name, payload.kind, payload.number
    )
    if existing is not None:
        # Same (repo, kind, number) already has a running or completed
        # investigation — return it instead of starting a duplicate, which
        # is what produced two attention-queue cards for the same issue.
        return {"investigation_id": existing["id"], "reused": True}

    investigation_id = str(uuid.uuid4())
    repo.create_investigation(
        investigation_id=investigation_id,
        repo_name=payload.repo_name,
        kind=payload.kind,
        number=payload.number,
        title=f"{payload.kind} #{payload.number}",
    )

    if payload.kind == "issue":
        # _run_investigation is async — FastAPI schedules it on the SAME
        # running event loop after the response is sent. Do not wrap it in
        # asyncio.run() in a separate thread: that spins up a second event
        # loop, and mcp_server.client.call_tool_sync()'s cross-loop
        # run_coroutine_threadsafe() handoff back to the main loop can
        # self-deadlock from inside that second loop. Passing the coroutine
        # function directly keeps everything on one loop and one thread.
        background_tasks.add_task(
            _run_investigation, investigation_id, payload.repo_name, payload.number
        )

    return {"investigation_id": investigation_id}


@router.get("/api/investigations", response_model=list[InvestigationSummary])
async def list_investigations(repo_name: str | None = None) -> list[InvestigationSummary]:
    rows = repo.list_investigations()
    if repo_name:
        rows = [row for row in rows if row["repo_name"] == repo_name]
    return [
        InvestigationSummary(
            investigation_id=row["id"],
            repo_name=row["repo_name"],
            kind=row["kind"],
            number=row["number"],
            title=row["title"] or "",
            status=row["status"],
            decision=row["decision"],
            created_at=row["created_at"],
            completed_at=row["completed_at"],
        )
        for row in rows
    ]


@router.get("/api/investigations/{investigation_id}", response_model=InvestigationDetail)
async def get_investigation(investigation_id: str) -> InvestigationDetail:
    row = repo.get_investigation(investigation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="investigation not found")

    steps = repo.get_steps(investigation_id)

    return InvestigationDetail(
        investigation_id=row["id"],
        repo_name=row["repo_name"],
        kind=row["kind"],
        number=row["number"],
        title=row["title"] or "",
        status=row["status"],
        decision=row["decision"],
        created_at=row["created_at"],
        completed_at=row["completed_at"],
        steps=steps,
        decision_reason=row["decision_reason"],
        confidence=row["confidence"],
        impact_score=row["impact_score"],
    )


@router.get("/api/escalations", response_model=list[Escalation])
async def list_escalations(repo_name: str | None = None) -> list[Escalation]:
    rows = repo.list_escalations(resolved=False)
    if repo_name:
        rows = [row for row in rows if row["repo_name"] == repo_name]
    results = []
    for row in rows:
        investigation = repo.get_investigation(row["investigation_id"])
        results.append(
            Escalation(
                investigation_id=row["investigation_id"],
                reason=row["reason"],
                severity=row["severity"],
                number=investigation["number"] if investigation else 0,
                title=investigation["title"] if investigation else "",
                created_at=row["created_at"],
            )
        )
    return results


@router.get("/api/actions", response_model=list[SuggestedAction])
async def list_actions(
    repo_name: str | None = None, status: str | None = "pending"
) -> list[SuggestedAction]:
    rows = repo.list_suggested_actions(repo_name=repo_name, status=status)
    return [
        SuggestedAction(
            action_id=row["action_id"],
            investigation_id=row["investigation_id"],
            repo_name=row["repo_name"],
            number=row["number"],
            kind=row["kind"],
            payload=row["payload"],
            reason=row["reason"],
            confidence=row["confidence"],
            status=row["status"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


@router.post("/api/actions/{action_id}/approve", response_model=ApproveActionResponse)
async def approve_action(action_id: str) -> ApproveActionResponse:
    action = repo.get_suggested_action(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="action not found")
    if action["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"action already {action['status']}")

    if action["kind"] == "add_labels":
        result = await asyncio.to_thread(
            call_tool_sync,
            ADD_LABELS,
            {
                "repo_name": action["repo_name"],
                "issue_number": action["number"],
                "labels": action["payload"]["labels"],
            },
        )
    elif action["kind"] == "post_comment":
        result = await asyncio.to_thread(
            call_tool_sync,
            POST_ISSUE_COMMENT,
            {
                "repo_name": action["repo_name"],
                "issue_number": action["number"],
                "comment": action["payload"]["comment"],
            },
        )
    else:
        raise HTTPException(status_code=400, detail=f"unknown action kind {action['kind']}")

    repo.set_suggested_action_status(action_id, "approved")
    await ws.broadcast(
        {
            "type": "action.approved",
            "data": {"action_id": action_id, "investigation_id": action["investigation_id"]},
        }
    )
    return ApproveActionResponse(ok=True, result=result)


@router.post("/api/actions/{action_id}/reject", response_model=ApproveActionResponse)
async def reject_action(action_id: str) -> ApproveActionResponse:
    action = repo.get_suggested_action(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="action not found")
    if action["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"action already {action['status']}")
    repo.set_suggested_action_status(action_id, "rejected")
    return ApproveActionResponse(ok=True, result="rejected")
