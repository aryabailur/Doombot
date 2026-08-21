"""Maintainer feedback and approval-controlled GitHub actions."""
import logging

from fastapi import APIRouter, HTTPException, Query

from agents.triage.decider import apply_approved_action, writes_enabled
from api.schemas import (
    ActionDecisionRequest,
    ActionStatus,
    FeedbackRequest,
    ProposedAction,
    RepositoryPolicy,
)
from memory import repo

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/policy", response_model=RepositoryPolicy)
async def get_repository_policy(repo_name: str = Query(min_length=3)) -> RepositoryPolicy:
    """Return the decision-derived, approval-safe policy for one repository."""
    return RepositoryPolicy(**repo.get_repository_policy(repo_name))


@router.post("/api/feedback")
async def submit_feedback(request: FeedbackRequest) -> dict:
    repo.record_feedback(
        request.investigation_id,
        request.verdict,
        step_id=request.step_id,
        note=request.note,
    )
    return {"ok": True}


@router.get("/api/actions", response_model=list[ProposedAction])
async def list_actions(
    status: ActionStatus | None = Query(default=None),
    repo_name: str | None = Query(default=None),
) -> list[ProposedAction]:
    """List persisted action proposals, optionally scoped by status/repo."""
    return [
        ProposedAction(**item)
        for item in repo.list_proposed_actions(status=status, repo_name=repo_name)
    ]


@router.get("/api/actions/{action_id}", response_model=ProposedAction)
async def get_action(action_id: str) -> ProposedAction:
    action = repo.get_proposed_action(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="proposed action not found")
    return ProposedAction(**action)


@router.post("/api/actions/{action_id}/decision", response_model=ProposedAction)
async def decide_action(
    action_id: str,
    request: ActionDecisionRequest,
) -> ProposedAction:
    """Approve/reject once; execute and record an approved GitHub payload.

    The transition from ``approved`` to ``executing`` is an atomic claim in
    SQLite. A repeated request therefore returns 409 rather than posting the
    same comment twice. DEMO_MODE blocks approval before state changes.
    """
    current = repo.get_proposed_action(action_id)
    if current is None:
        raise HTTPException(status_code=404, detail="proposed action not found")
    if current["status"] != "proposed":
        raise HTTPException(
            status_code=409,
            detail=f"action is already {current['status']}",
        )
    if request.approved and not writes_enabled():
        raise HTTPException(
            status_code=409,
            detail="DEMO_MODE=1 blocks GitHub writes; the proposal remains pending",
        )

    decided = repo.decide_proposed_action(
        action_id,
        approved=request.approved,
        decided_by=request.decided_by.strip() or "maintainer",
        note=request.note,
    )
    if decided is None:
        raise HTTPException(status_code=409, detail="action was decided concurrently")

    repo.record_feedback(
        decided["investigation_id"],
        "up" if request.approved else "down",
        note=request.note,
    )
    if not request.approved:
        return ProposedAction(**decided)

    if not repo.mark_action_executing(action_id):
        raise HTTPException(status_code=409, detail="action could not be claimed")

    try:
        result = await apply_approved_action(
            decided["repo_name"],
            decided["issue_number"],
            decided.get("comment") or "",
            decided.get("labels") or [],
        )
    except Exception:
        logger.exception("approved GitHub action %s failed", action_id)
        failed = repo.complete_action(
            action_id,
            error="GitHub action failed; check backend logs and token permissions.",
        )
        return ProposedAction(**failed)

    completed = repo.complete_action(action_id, result=result)
    return ProposedAction(**completed)
