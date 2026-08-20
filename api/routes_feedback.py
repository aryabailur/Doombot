"""Feedback endpoint.

    POST /api/feedback -> {ok: true}

Per the plan's cut list: feedback is logged and displayed, but does not
alter agent behavior during the hackathon.
"""
from fastapi import APIRouter

from api.schemas import FeedbackRequest
from memory import repo

router = APIRouter()


@router.post("/api/feedback")
async def submit_feedback(request: FeedbackRequest) -> dict:
    repo.record_feedback(
        request.investigation_id,
        request.verdict,
        step_id=request.step_id,
        note=request.note,
    )
    return {"ok": True}
