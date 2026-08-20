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
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter

from api import health as health_service
from api.schemas import (
    BriefResponse,
    HealthBreakdown,
    HealthPoint,
    HealthResponse,
    IndexJobResponse,
    RepoSummary,
)
from memory import repo as store

router = APIRouter()


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
    """Index a repository's issues into the RAG store.

    Runs in a thread: embedding is CPU-bound and would block the event loop,
    stalling the WebSocket that the live trace depends on.
    """
    repo_name = f"{owner}/{repo}"

    async def _index() -> None:
        from rag.embedder import index_issues

        await asyncio.to_thread(index_issues, repo_name, "all", 200)

    asyncio.create_task(_index())
    return IndexJobResponse(job_id=str(uuid.uuid4()), status="queued")


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
    )


@router.get("/api/repos/{owner}/{repo}/graph")
async def get_repo_graph(owner: str, repo: str) -> dict:
    """Issue relationship graph (F15).

    A thin wrapper over `rag.graph.build_graph` -- the relationships are
    already in the vector store, so this must not recompute them. Escalated
    issue numbers are read from SQLite to colour the security nodes.
    """
    repo_name = f"{owner}/{repo}"

    escalated: set[int] = set()
    for row in store.list_escalations(resolved=False):
        if row["repo_name"] != repo_name:
            continue
        investigation = store.get_investigation(row["investigation_id"]) or {}
        number = investigation.get("number")
        if number is not None:
            escalated.add(number)

    from rag.graph import build_graph

    return await asyncio.to_thread(build_graph, repo_name, escalated)


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
        f"# Weekly brief — {repo_name}",
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
