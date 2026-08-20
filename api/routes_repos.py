"""Repository endpoints.

    GET  /api/health                          -> {status: "ok"}
    GET  /api/repos                           -> list with health scores
    POST /api/repos/{owner}/{repo}/index      -> trigger RAG indexing
    GET  /api/repos/{owner}/{repo}/graph      -> issue relationship graph
    GET  /api/repos/{owner}/{repo}/code-graph -> semantic code + impact graph
    GET  /api/repos/{owner}/{repo}/health     -> score + breakdown + history
    GET  /api/brief/{owner}/{repo}            -> weekly brief markdown

Repository summaries, health, and briefs remain fixtures. The two F15 graph
routes are real read-only views over indexed issues and repository source.
"""
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from fastapi import APIRouter, Query

from api.schemas import (
    BriefResponse,
    CodeGraphResponse,
    GraphResponse,
    HealthBreakdown,
    HealthPoint,
    HealthResponse,
    IndexJobResponse,
    RepoSummary,
)
from memory import repo as memory_repo
from rag.graph import build_code_graph, build_graph

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
    _cached_code_graph.cache_clear()
    return IndexJobResponse(job_id=str(uuid.uuid4()), status="queued")


def _escalated_issue_numbers(repo_name: str) -> set[int]:
    numbers: set[int] = set()
    try:
        for escalation in memory_repo.list_escalations(resolved=False):
            if escalation.get("repo_name") != repo_name:
                continue
            investigation = memory_repo.get_investigation(
                escalation["investigation_id"]
            )
            if investigation and investigation.get("kind") == "issue":
                numbers.add(int(investigation["number"]))
    except Exception:
        # The graph is still useful before SQLite has been initialized.
        return set()
    return numbers


@router.get(
    "/api/repos/{owner}/{repo}/graph",
    response_model=GraphResponse,
)
def get_issue_graph(owner: str, repo: str) -> GraphResponse:
    repo_name = f"{owner}/{repo}"
    return GraphResponse.model_validate(
        build_graph(repo_name, _escalated_issue_numbers(repo_name))
    )


@lru_cache(maxsize=8)
def _cached_code_graph(repo_name: str, changed_paths: tuple[str, ...]) -> dict:
    return build_code_graph(repo_name, changed_paths)


@router.get(
    "/api/repos/{owner}/{repo}/code-graph",
    response_model=CodeGraphResponse,
)
def get_code_graph(
    owner: str,
    repo: str,
    changed_path: list[str] = Query(default=[]),
) -> CodeGraphResponse:
    """Return semantic code structure with an optional impact overlay.

    Repeat `changed_path` to model all files touched by a pull request. Graph
    construction is deterministic and read-only; the small cache keeps tab
    changes responsive and is invalidated when repository indexing is
    requested.
    """
    repo_name = f"{owner}/{repo}"
    graph = _cached_code_graph(repo_name, tuple(sorted(set(changed_path))))
    return CodeGraphResponse.model_validate(graph)


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
