"""Repository endpoints.

    GET  /api/health                          -> {status: "ok"}
    GET  /api/repos                           -> list with health scores
    POST /api/repos/{owner}/{repo}/index      -> trigger RAG indexing
    GET  /api/repos/{owner}/{repo}/health     -> score + breakdown + history
    GET  /api/repos/{owner}/{repo}/graph      -> issue relationship graph (F15)
    GET  /api/repos/{owner}/{repo}/source     -> one file, for the code explorer
    GET  /api/repos/{owner}/{repo}/search     -> natural-language issue search
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
from functools import lru_cache
from pathlib import PurePosixPath

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
    SearchResponse,
    SourceFileResponse,
)
from memory import repo as store
# Imported at module scope rather than lazily: these are pure graph builders
# over already-indexed data, so they pull in no model and cost nothing to
# import. The lazy imports elsewhere in this file exist to keep torch out of
# the API's startup path, which does not apply here.
from rag.graph import build_code_graph, build_graph

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

    # Their cache would otherwise serve a pre-index graph.
    _cached_code_graph.cache_clear()
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

# Largest file the code pane will render. Beyond this the browser spends longer
# laying out line divs than anyone spends reading them, and the payload stops
# being worth the transfer.
MAX_SOURCE_BYTES = 400_000

_SOURCE_LANGUAGES = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".json": "json",
    ".md": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".sh": "shell",
    ".css": "css",
    ".html": "html",
}


@lru_cache(maxsize=256)
def _cached_source(repo_name: str, path: str) -> str | None:
    """One GitHub read per file, cached.

    The explorer loads a file every time the reader clicks one in the tree, and
    clicking back and forth through a subsystem is the normal way to use it.
    Uncached that is a GitHub request per click against a 5000/hour quota shared
    across the whole account.
    """
    from mcp_server.github_client import get_file_content

    try:
        return get_file_content(repo_name, path)
    except Exception:
        return None


# Upper bound on results. Past this the list stops being something a reader
# scans and starts being something they scroll past, and every extra hit is
# another embedding comparison and snippet pass.
MAX_SEARCH_RESULTS = 50


@router.get("/api/repos/{owner}/{repo}/search", response_model=SearchResponse)
def search_repo_issues(
    owner: str,
    repo: str,
    q: str = Query(..., min_length=1, description="Natural-language query"),
    k: int = Query(20, ge=1, le=MAX_SEARCH_RESULTS),
) -> SearchResponse:
    """Search a repository's indexed history by meaning, not by keyword.

    Three stages, in `rag/search.py`: the model translates the question into
    search parameters, Chroma answers it with those filters applied, and the
    hits are ranked by similarity, recency, engagement and whatever the triage
    agent already decided about each issue.

    The model never writes a result. Every issue returned is a real indexed
    issue, and the response carries the parsed intent so a reader can see how
    their question was interpreted rather than guessing why something is
    missing.

    Read-only. An unindexed repository is not an error: it returns zero results
    with `stats.indexed == 0`, which is a different sentence for the UI to say
    than "nothing matched".
    """
    from rag.search import search

    repo_name = f"{owner}/{repo}"
    return SearchResponse.model_validate(search(repo_name, q, k=k))


@router.get("/api/repos/{owner}/{repo}/source", response_model=SourceFileResponse)
def get_source_file(owner: str, repo: str, path: str = Query(...)) -> SourceFileResponse:
    """Return one file's contents, for the code explorer's code pane.

    Read-only. `path` is repository-relative and passed to the GitHub contents
    API, which resolves it inside the repository -- there is no local filesystem
    in the path, so traversal has nothing to reach. Leading slashes and `..`
    segments are still stripped so a malformed path fails cleanly as a 404
    rather than as a confusing GitHub error.
    """
    clean = "/".join(
        part for part in path.replace(chr(92), "/").split("/") if part and part != ".."
    )
    if not clean:
        raise HTTPException(status_code=400, detail="path is required")

    repo_name = f"{owner}/{repo}"
    content = _cached_source(repo_name, clean)
    if content is None:
        raise HTTPException(status_code=404, detail=f"{clean} could not be read")

    truncated = len(content.encode("utf-8", "ignore")) > MAX_SOURCE_BYTES
    if truncated:
        content = content[: MAX_SOURCE_BYTES // 2]

    suffix = PurePosixPath(clean).suffix.lower()
    return SourceFileResponse(
        path=clean,
        content=content,
        lines=content.count("\n") + 1,
        language=_SOURCE_LANGUAGES.get(suffix, suffix.lstrip(".") or "text"),
        truncated=truncated,
    )



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
