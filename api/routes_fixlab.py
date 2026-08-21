"""Explicit Fix Lab generation, verification, and review endpoints."""

import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from api.schemas import CreateFixRunRequest, FixDecisionRequest, FixRun
from fixlab.service import candidate_paths, run_fix
from memory import repo


router = APIRouter()


@router.post("/api/fix-runs", response_model=FixRun)
async def create_fix_run(
    request: CreateFixRunRequest,
    background: BackgroundTasks,
) -> FixRun:
    investigation = repo.get_investigation(request.investigation_id)
    if investigation is None:
        raise HTTPException(status_code=404, detail="investigation not found")
    if investigation["status"] != "done" or investigation["kind"] != "issue":
        raise HTTPException(status_code=409, detail="a completed issue investigation is required")
    if not candidate_paths(request.investigation_id):
        raise HTTPException(status_code=409, detail="investigation has no grounded code candidates")

    run_id = str(uuid.uuid4())
    created = repo.create_fix_run(
        run_id,
        request.investigation_id,
        investigation["repo_name"],
        investigation["number"],
    )
    background.add_task(run_fix, run_id)
    return FixRun(**created)


@router.get("/api/fix-runs", response_model=list[FixRun])
async def list_fix_runs(repo_name: str | None = Query(default=None)) -> list[FixRun]:
    return [FixRun(**item) for item in repo.list_fix_runs(repo_name)]


@router.get("/api/fix-runs/{run_id}", response_model=FixRun)
async def get_fix_run(run_id: str) -> FixRun:
    run = repo.get_fix_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="fix run not found")
    return FixRun(**run)


@router.post("/api/fix-runs/{run_id}/decision", response_model=FixRun)
async def decide_fix_run(run_id: str, request: FixDecisionRequest) -> FixRun:
    """Review a verified diff. Approval does not publish a branch or PR yet."""
    current = repo.get_fix_run(run_id)
    if current is None:
        raise HTTPException(status_code=404, detail="fix run not found")
    if current["status"] != "proposed":
        raise HTTPException(status_code=409, detail=f"fix run is already {current['status']}")
    decided = repo.decide_fix_run(
        run_id,
        request.approved,
        request.decided_by.strip() or "maintainer",
        request.note,
    )
    if decided is None:
        raise HTTPException(status_code=409, detail="fix run was decided concurrently")
    return FixRun(**decided)
