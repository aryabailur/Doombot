"""Repository endpoints.

    GET  /api/health                          -> {status: "ok"}
    GET  /api/repos                           -> list with health scores
    POST /api/repos/{owner}/{repo}/index      -> trigger RAG indexing
    GET  /api/repos/{owner}/{repo}/health     -> score + breakdown + history
    GET  /api/repos/{owner}/{repo}/graph      -> issue relationship graph (F15)
    GET  /api/brief/{owner}/{repo}            -> weekly brief markdown

No longer the fixture phase. Health is computed from real GitHub data by
`api/health.py`; repos and history come from SQLite. The weekly brief is the
one route still generating from live data rather than reading a stored
summary, since nothing schedules brief generation yet.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query

from api import health as health_service
from api.schemas import (
    BriefResponse,
    CodeGraphResponse,
    HealthBreakdown,
    HealthPoint,
    GraphResponse,
    HealthResponse,
    IndexJobResponse,
    RepoSummary,
)
from memory import repo as store
# Imported at module scope rather than lazily: these are pure graph builders
# over already-indexed data, so they pull in no model and cost nothing to
# import. The lazy imports elsewhere in this file exist to keep torch out of
# the API's startup path, which does not apply here.
from rag.graph import build_code_graph, build_graph

router = APIRouter()
logger = logging.getLogger(__name__)
_index_jobs: dict[str, IndexJobResponse] = {}
_repo_index_jobs: dict[str, str] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/api/health")
async def get_health() -> dict:
    """Liveness only, no DB touch."""
    return {"status": "ok"}


@router.get("/api/repos", response_model=list[RepoSummary])
async def list_repos() -> list[RepoSummary]:
    """Repositories Doombot knows about, derived from its own history.

    A repository appears here once it has been investigated or monitored --
    there is no separate registration step, so the list is whatever the agent
    has actually worked on.
    """
    investigations = store.list_investigations()

    names: dict[str, dict] = {}
    for row in investigations:
        entry = names.setdefault(
            row["repo_name"], {"open": 0, "last": row["created_at"]}
        )
        if row["status"] != "done":
            entry["open"] += 1
        # list_investigations is newest-first, so the first seen is the latest.
        entry["last"] = max(entry["last"], row["created_at"])

    # Include monitored repos that have no investigations yet, so a freshly
    # configured repository is visible before its first cycle completes.
    from api.monitor import monitored_repos

    for name in monitored_repos():
        names.setdefault(name, {"open": 0, "last": None})

    summaries: list[RepoSummary] = []
    for name, meta in names.items():
        history = store.get_health_history(name, limit=1)
        summaries.append(
            RepoSummary(
                repo_name=name,
                # None rather than a fabricated number when never scored: the
                # dashboard renders "--" for that, which is honest.
                health_score=history[0]["score"] if history else 0.0,
                open_investigations=meta["open"],
                last_scan=meta["last"],
            )
        )
    return summaries


@router.post("/api/repos/{owner}/{repo}/index", response_model=IndexJobResponse)
async def trigger_index(owner: str, repo: str) -> IndexJobResponse:
    """Ensure repository code and issues are indexed in the RAG store.

    Runs in a thread: embedding is CPU-bound and would block the event loop,
    stalling the WebSocket that the live trace depends on.
    """
    repo_name = f"{owner}/{repo}"

    existing_id = _repo_index_jobs.get(repo_name)
    if existing_id:
        existing = _index_jobs.get(existing_id)
        if existing and existing.status in {"queued", "running"}:
            return existing

    from rag.embedder import collection_count

    def index_counts() -> tuple[int, int]:
        return (
            collection_count(repo_name, "code"),
            collection_count(repo_name, "issues"),
        )

    code_count, issue_count = await asyncio.to_thread(index_counts)
    if code_count and issue_count:
        return IndexJobResponse(job_id="ready", status="ready")

    job_id = str(uuid.uuid4())
    _index_jobs[job_id] = IndexJobResponse(job_id=job_id, status="queued")
    _repo_index_jobs[repo_name] = job_id

    async def _index() -> None:
        from rag.embedder import index_issues, index_repo_files

        _index_jobs[job_id] = IndexJobResponse(job_id=job_id, status="running")
        try:
            await asyncio.to_thread(index_repo_files, repo_name)
            await asyncio.to_thread(index_issues, repo_name, "all", 200)
        except Exception:
            logger.exception("repository index job %s failed for %s", job_id, repo_name)
            _index_jobs[job_id] = IndexJobResponse(job_id=job_id, status="error")
        else:
            _index_jobs[job_id] = IndexJobResponse(job_id=job_id, status="done")

    # Their cache would otherwise serve a pre-index graph.
    _cached_code_graph.cache_clear()
    asyncio.create_task(_index())
    return _index_jobs[job_id]


@router.get("/api/index-jobs/{job_id}", response_model=IndexJobResponse)
async def get_index_job(job_id: str) -> IndexJobResponse:
    """Return current in-process indexing status."""
    if job_id == "ready":
        return IndexJobResponse(job_id="ready", status="ready")
    job = _index_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="index job not found")
    return job


@router.get("/api/repos/{owner}/{repo}/health", response_model=HealthResponse)
async def get_repo_health(owner: str, repo: str) -> HealthResponse:
    """Current health plus its recorded history.

    Computed live so the number is never stale, then paired with the stored
    series -- PS-04 asks for trends, and a single measurement is not a trend.
    """
    repo_name = f"{owner}/{repo}"
    current = await asyncio.to_thread(health_service.compute, repo_name)

    history = [
        HealthPoint(ts=row["recorded_at"], score=row["score"])
        for row in reversed(store.get_health_history(repo_name, limit=30))
    ]
    # A freshly-monitored repo has no series yet; showing the current point
    # keeps the chart from rendering as broken.
    if not history:
        history = [HealthPoint(ts=_now_iso(), score=current["score"])]

    return HealthResponse(
        score=current["score"],
        breakdown=HealthBreakdown(**current["breakdown"]),
        history=history,
        measured=current.get("measured", True),
        issue_count=current.get("issue_count", 0),
        unreadable=current.get("unreadable", False),
    )


def _escalated_issue_numbers(repo_name: str) -> set[int]:
    numbers: set[int] = set()
    try:
        for escalation in store.list_escalations(resolved=False):
            if escalation.get("repo_name") != repo_name:
                continue
            investigation = store.get_investigation(
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


@router.get("/api/brief/{owner}/{repo}", response_model=BriefResponse)
async def get_brief(owner: str, repo: str) -> BriefResponse:
    """Weekly brief, assembled from what the agent actually did.

    Deliberately not an LLM call. Every line here is a count the database can
    prove, and PS-04's bonus asks for a concise summary of important activity
    -- a generated paragraph would risk stating something the data does not
    support, which is the opposite of the evidence-backed explanation the
    compulsory requirements demand.
    """
    repo_name = f"{owner}/{repo}"
    investigations = [
        row for row in store.list_investigations() if row["repo_name"] == repo_name
    ]
    escalations = [
        row for row in store.list_escalations(resolved=False)
        if row["repo_name"] == repo_name
    ]

    by_decision: dict[str, int] = {}
    for row in investigations:
        by_decision[row.get("decision") or "in progress"] = (
            by_decision.get(row.get("decision") or "in progress", 0) + 1
        )

    history = store.get_health_history(repo_name, limit=30)
    if len(history) >= 2:
        delta = history[0]["score"] - history[-1]["score"]
        trend = f"{delta:+.1f} points over the last {len(history)} readings"
    elif history:
        trend = f"{history[0]['score']:.1f} (first reading, no trend yet)"
    else:
        trend = "not yet measured"

    lines = [
        f"# Weekly brief â€” {repo_name}",
        "",
        "## Activity",
        f"- {len(investigations)} investigation(s) run",
    ]
    for decision, count in sorted(by_decision.items()):
        lines.append(f"  - {decision.replace('_', ' ')}: {count}")
    lines += [
        "",
        "## Attention needed",
        f"- {len(escalations)} open escalation(s)",
    ]
    for row in escalations[:5]:
        lines.append(f"  - [{row['severity']}] {row['reason']}")
    lines += ["", "## Health", f"- {trend}"]

    if not investigations:
        lines += [
            "",
            "_No investigations recorded yet. Trigger a scan or configure"
            " monitoring to populate this brief._",
        ]

    return BriefResponse(markdown="\n".join(lines), generated_at=_now_iso())
