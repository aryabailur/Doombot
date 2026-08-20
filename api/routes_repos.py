"""Repository endpoints.

    GET  /api/health                          -> {status: "ok"}
    GET  /api/repos                           -> list with health scores
    POST /api/repos/{owner}/{repo}/index      -> trigger RAG indexing
    GET  /api/repos/{owner}/{repo}/health     -> score + breakdown + history
    GET  /api/brief/{owner}/{repo}            -> weekly brief markdown

Fixture phase (see api/CLAUDE.md §2): every route below returns a
hardcoded instance of the matching Pydantic model. No RAG/health-scoring
logic and no DB access yet — that comes in a later pass.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from api.schemas import (
    BriefResponse,
    HealthBreakdown,
    HealthPoint,
    HealthResponse,
    IndexJobResponse,
    RepoSummary,
)

# Tunable constants — health score weights (api/CLAUDE.md §8).
# Unused during the fixture phase; wired up when real scoring lands.
WEIGHT_SECURITY = 0.35
WEIGHT_STALENESS = 0.25
WEIGHT_DUPLICATION = 0.15
WEIGHT_RESPONSIVENESS = 0.25

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/api/health")
async def get_health() -> dict:
    """Liveness only, no DB touch."""
    return {"status": "ok"}


@router.get("/api/repos", response_model=list[RepoSummary])
async def list_repos() -> list[RepoSummary]:
    now = datetime.now(timezone.utc)
    return [
        RepoSummary(
            repo_name="octocat/Hello-World",
            health_score=82.4,
            open_investigations=3,
            last_scan=(now - timedelta(hours=2)).isoformat(),
        ),
        RepoSummary(
            repo_name="doombot-labs/agent-runtime",
            health_score=67.1,
            open_investigations=7,
            last_scan=(now - timedelta(hours=6)).isoformat(),
        ),
        RepoSummary(
            repo_name="doombot-labs/rag-indexer",
            health_score=91.0,
            open_investigations=1,
            last_scan=(now - timedelta(minutes=45)).isoformat(),
        ),
    ]


@router.post("/api/repos/{owner}/{repo}/index", response_model=IndexJobResponse)
async def trigger_index(owner: str, repo: str) -> IndexJobResponse:
    return IndexJobResponse(job_id=str(uuid.uuid4()), status="queued")


@router.get("/api/repos/{owner}/{repo}/health", response_model=HealthResponse)
async def get_repo_health(owner: str, repo: str) -> HealthResponse:
    now = datetime.now(timezone.utc)
    history = [
        HealthPoint(ts=(now - timedelta(days=d)).isoformat(), score=score)
        for d, score in [(6, 74.0), (5, 76.5), (4, 75.0), (3, 79.2), (2, 80.1), (1, 81.0), (0, 82.4)]
    ]
    return HealthResponse(
        score=82.4,
        breakdown=HealthBreakdown(
            security=88.0,
            staleness=71.5,
            duplication=90.0,
            responsiveness=78.3,
        ),
        history=history,
    )


@router.get("/api/brief/{owner}/{repo}", response_model=BriefResponse)
async def get_brief(owner: str, repo: str) -> BriefResponse:
    markdown = f"""# Weekly Brief: {owner}/{repo}

## Summary
Repository health is trending upward (+3.2 pts this week). Security posture
remains strong; staleness on long-open issues is the main drag on score.

## Highlights
- 3 investigations opened, 2 auto-resolved, 1 escalated for human review
- No new critical vulnerabilities detected
- 2 duplicate issues identified and linked

## Recommendations
- Triage the 4 issues open longer than 30 days
- Review escalated PR #142 for merge conflicts
"""
    return BriefResponse(markdown=markdown, generated_at=_now_iso())
