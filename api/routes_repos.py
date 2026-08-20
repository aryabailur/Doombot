"""Repository endpoints.

    GET  /api/health                          -> {status: "ok"}
    GET  /api/repos                           -> list with health scores
    POST /api/repos/{owner}/{repo}/index      -> trigger RAG indexing
    GET  /api/repos/{owner}/{repo}/health     -> score + breakdown + history
    GET  /api/brief/{owner}/{repo}            -> weekly brief markdown
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks

from api.schemas import (
    ActivityEvent,
    ActivityPage,
    BriefResponse,
    HealthBreakdown,
    HealthForecast,
    HealthPoint,
    HealthResponse,
    IndexJobResponse,
    MemoryQueryResponse,
    MemoryQueryResult,
    RepoSummary,
)
from memory import repo as db
from rag.embedder import embeder, index_issues
from rag.retriever import retrieve_with_scores

logger = logging.getLogger(__name__)

# Tunable constants — health score weights (api/CLAUDE.md §8).
WEIGHT_SECURITY = 0.35
WEIGHT_STALENESS = 0.25
WEIGHT_DUPLICATION = 0.15
WEIGHT_RESPONSIVENESS = 0.25

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_issue_index_job(repo_name: str) -> None:
    """Issue indexing: fast (one GitHub call per issue, capped), needed for
    duplicate detection. Run independently of file indexing so a slow or
    failing file-index never blocks the issue index duplicate detection
    depends on."""
    try:
        index_issues(repo_name)
    except Exception:
        logger.exception("index_issues failed for %s", repo_name)


def _run_file_index_job(repo_name: str) -> None:
    """File indexing: one GitHub call per file in the repo tree — can take
    minutes on a repo with 100+ files. Runs after issue indexing, in its
    own background task, so it never blocks the fast/important path."""
    try:
        embeder(repo_name)
    except Exception:
        logger.exception("embeder (file index) failed for %s", repo_name)


def _compute_health_breakdown(repo_name: str) -> HealthBreakdown:
    """Derive the four sub-scores from investigations recorded for this repo.

    Each sub-score is 0-100. With no data yet, everything defaults to a
    neutral 70 rather than a misleadingly perfect 100.
    """
    investigations = [i for i in db.list_investigations() if i["repo_name"] == repo_name]
    if not investigations:
        return HealthBreakdown(security=70.0, staleness=70.0, duplication=70.0, responsiveness=70.0)

    total = len(investigations)
    security_hits = sum(1 for i in investigations if i["decision"] == "escalate")
    duplicate_hits = sum(1 for i in investigations if i["decision"] == "close_as_duplicate")
    running = sum(1 for i in investigations if i["status"] == "running")

    security = max(0.0, 100.0 - (security_hits / total) * 100.0)
    duplication = max(0.0, 100.0 - (duplicate_hits / total) * 100.0)
    responsiveness = max(0.0, 100.0 - (running / total) * 50.0)
    staleness = 70.0  # no repo-age signal wired yet; neutral default

    return HealthBreakdown(
        security=round(security, 1),
        staleness=staleness,
        duplication=round(duplication, 1),
        responsiveness=round(responsiveness, 1),
    )


def _weighted_score(breakdown: HealthBreakdown) -> float:
    return round(
        WEIGHT_SECURITY * breakdown.security
        + WEIGHT_STALENESS * breakdown.staleness
        + WEIGHT_DUPLICATION * breakdown.duplication
        + WEIGHT_RESPONSIVENESS * breakdown.responsiveness,
        1,
    )


FORECAST_HORIZON_DAYS = 90


def _compute_forecast(history: list[HealthPoint], open_investigations: int) -> HealthForecast | None:
    """Simple linear projection off the recorded health-score trend.

    Needs at least two history points to have a trend to project — with
    fewer, there's nothing to extrapolate, so no forecast is returned
    rather than fabricating a flat/fake one.
    """
    if len(history) < 2:
        return None

    first, last = history[0], history[-1]
    delta = last.score - first.score
    span = max(len(history) - 1, 1)
    slope_per_point = delta / span
    projected_score = max(0.0, min(100.0, last.score + slope_per_point * FORECAST_HORIZON_DAYS / max(span, 1)))

    if delta > 2:
        trend: str = "improving"
    elif delta < -2:
        trend = "declining"
    else:
        trend = "stable"

    confidence = round(min(0.9, 0.5 + 0.05 * len(history)), 2)

    backlog_slope = 1 if trend == "declining" else (-1 if trend == "improving" else 0)
    projected_backlog = max(0.0, open_investigations + backlog_slope * open_investigations * 0.3)

    if trend == "declining":
        reason = (
            f"Health score dropped {abs(delta):.1f} pts over the last {len(history)} "
            f"recorded snapshots; extrapolating that trend {FORECAST_HORIZON_DAYS} days out."
        )
    elif trend == "improving":
        reason = (
            f"Health score rose {delta:.1f} pts over the last {len(history)} recorded "
            f"snapshots; extrapolating that trend {FORECAST_HORIZON_DAYS} days out."
        )
    else:
        reason = f"Health score has been flat across the last {len(history)} recorded snapshots."

    return HealthForecast(
        horizon_days=FORECAST_HORIZON_DAYS,
        projected_score=round(projected_score, 1),
        projected_backlog=round(projected_backlog, 1),
        confidence=confidence,
        trend=trend,
        reason=reason,
    )


@router.get("/api/health")
async def get_health() -> dict:
    """Liveness only, no DB touch."""
    return {"status": "ok"}


@router.get("/api/repos", response_model=list[RepoSummary])
async def list_repos() -> list[RepoSummary]:
    investigations = db.list_investigations()
    by_repo: dict[str, list[dict]] = {}
    for inv in investigations:
        by_repo.setdefault(inv["repo_name"], []).append(inv)

    results = []
    for repo_name, invs in by_repo.items():
        breakdown = _compute_health_breakdown(repo_name)
        score = _weighted_score(breakdown)
        open_count = sum(1 for i in invs if i["status"] == "running")
        last_scan = max((i["created_at"] for i in invs), default=None)
        results.append(
            RepoSummary(
                repo_name=repo_name,
                health_score=score,
                open_investigations=open_count,
                last_scan=last_scan,
            )
        )
    return results


@router.post("/api/repos/{owner}/{repo}/index", response_model=IndexJobResponse)
async def trigger_index(owner: str, repo: str, background_tasks: BackgroundTasks) -> IndexJobResponse:
    repo_name = f"{owner}/{repo}"
    job_id = str(uuid.uuid4())
    background_tasks.add_task(_run_issue_index_job, repo_name)
    background_tasks.add_task(_run_file_index_job, repo_name)
    return IndexJobResponse(job_id=job_id, status="queued")


@router.get("/api/repos/{owner}/{repo}/health", response_model=HealthResponse)
async def get_repo_health(owner: str, repo: str) -> HealthResponse:
    repo_name = f"{owner}/{repo}"
    breakdown = _compute_health_breakdown(repo_name)
    score = _weighted_score(breakdown)

    history_rows = db.get_health_history(repo_name, limit=30)
    if history_rows:
        history = [HealthPoint(ts=row["recorded_at"], score=row["score"]) for row in history_rows]
    else:
        history = [HealthPoint(ts=_now_iso(), score=score)]

    db.record_health_score(
        repo_name=repo_name,
        score=score,
        security=breakdown.security,
        staleness=breakdown.staleness,
        duplication=breakdown.duplication,
        responsiveness=breakdown.responsiveness,
    )

    open_investigations = sum(
        1 for i in db.list_investigations() if i["repo_name"] == repo_name and i["status"] == "running"
    )
    forecast = _compute_forecast(history, open_investigations)

    return HealthResponse(score=score, breakdown=breakdown, history=history, forecast=forecast)


@router.get("/api/brief/{owner}/{repo}", response_model=BriefResponse)
async def get_brief(owner: str, repo: str) -> BriefResponse:
    repo_name = f"{owner}/{repo}"
    investigations = [i for i in db.list_investigations() if i["repo_name"] == repo_name]
    total = len(investigations)
    escalated = sum(1 for i in investigations if i["decision"] == "escalate")
    duplicates = sum(1 for i in investigations if i["decision"] == "close_as_duplicate")
    resolved = sum(1 for i in investigations if i["status"] == "done")

    markdown = f"""# Weekly Brief: {repo_name}

## Summary
{total} investigations recorded. {resolved} resolved automatically, {escalated} escalated for human review.

## Highlights
- {escalated} investigation(s) escalated for human review
- {duplicates} issue(s) closed as duplicates
- {total - escalated - duplicates} handled by other decisions (follow-up, hold, auto-comment)
"""
    return BriefResponse(markdown=markdown, generated_at=_now_iso())


@router.get("/api/repos/{owner}/{repo}/memory", response_model=MemoryQueryResponse)
async def query_memory(owner: str, repo: str, q: str, k: int = 8) -> MemoryQueryResponse:
    """Ad-hoc similarity search over this repo's indexed project memory —
    both the issue corpus and the code corpus — the real retrieval-browser
    endpoint ProjectMemory.tsx needs instead of deriving stats from
    investigation history alone."""
    repo_name = f"{owner}/{repo}"
    results: list[MemoryQueryResult] = []

    for collection, item_type in (("issues", "issue"), ("code", "file")):
        try:
            hits = retrieve_with_scores(q, repo_name, collection, k=k)
        except Exception:
            continue
        for doc, score in hits:
            meta = doc.metadata or {}
            if item_type == "issue":
                number = meta.get("number")
                title = doc.page_content.split("\n", 1)[0]
                url = f"https://github.com/{repo_name}/issues/{number}" if number else None
                reason = f"Semantic match on issue title/body, {score:.0%} relevance"
                item_id = f"issue-{number}"
            else:
                number = None
                title = meta.get("source", "file")
                url = f"https://github.com/{repo_name}/blob/main/{title}"
                reason = f"Semantic match on file content, {score:.0%} relevance"
                item_id = f"file-{title}"
            results.append(
                MemoryQueryResult(
                    item_id=item_id,
                    type=item_type,
                    title=title,
                    score=round(score, 3),
                    reason=reason,
                    number=number,
                    url=url,
                )
            )

    results.sort(key=lambda r: r.score, reverse=True)
    return MemoryQueryResponse(query=q, results=results[:k])


@router.get("/api/activity", response_model=ActivityPage)
async def get_activity(repo_name: str | None = None, limit: int = 50) -> ActivityPage:
    """Persistent, paginated view over chain_steps — unlike the WebSocket
    stream (which carries no history), this survives a page refresh."""
    steps = db.list_recent_steps(repo_name=repo_name, limit=limit)
    events = [
        ActivityEvent(
            ts=step["started_at"],
            investigation_id=step["investigation_id"],
            repo_name=step["inv_repo_name"],
            kind=step["name"],
            message=f"{step['title']} — {step['status']}",
            severity="error" if step["status"] == "error" else "info",
            number=step["inv_number"],
        )
        for step in steps
    ]
    return ActivityPage(events=events, next_cursor=None)
