"""Repository endpoints.

    GET  /api/health                          -> {status: "ok"}
    GET  /api/repos                           -> list with health scores
    POST /api/repos/{owner}/{repo}/index      -> trigger RAG indexing
    GET  /api/repos/{owner}/{repo}/health     -> score + breakdown + history
    GET  /api/brief/{owner}/{repo}            -> weekly brief markdown
"""
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks
from github import Github
from github.GithubRetry import GithubRetry

from api.schemas import (
    ActivityEvent,
    ActivityPage,
    BriefResponse,
    GraphLink,
    GraphNode,
    HealthBreakdown,
    HealthForecast,
    HealthPoint,
    HealthResponse,
    IndexJobResponse,
    MemoryQueryResponse,
    MemoryQueryResult,
    RepoGraphResponse,
    RepoSummary,
)
from memory import repo as db
from mcp_server.github_client import get_repo_files
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
        for doc, raw_score in hits:
            # similarity_search_with_relevance_scores can return values
            # slightly outside [0, 1] when the underlying distance
            # distribution is unusual (e.g. a query with generally low
            # similarity to the whole corpus) — clamp for display so the
            # UI never shows a nonsensical negative relevance percentage.
            score = max(0.0, min(1.0, raw_score))
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


# Cap on File+Directory nodes so the graph stays renderable on large repos.
GRAPH_MAX_FS_NODES = 300

# Same skip lists mcp_server.github_client.get_repo_files uses, duplicated
# here (not imported) since they're private module constants there, not a
# public contract — keeping this endpoint's fast path self-contained.
_GRAPH_SKIP_EXTENSIONS = (".png", ".jpg", ".gif", ".svg", ".ico", ".pdf", ".zip", ".node")
_GRAPH_SKIP_DIRS = ("node_modules", ".git", "venv", "__pycache__", "dist", "build")

_graph_gh_client: Github | None = None


def _get_graph_gh_client() -> Github:
    """Own cached PyGithub client for this endpoint's fast tree fetch —
    mirrors the caching pattern in mcp_server/github_client.py (see
    mcp_server/CLAUDE.md §5) without importing its module-private client,
    since that file is Person B's and out of scope to edit here."""
    global _graph_gh_client
    if _graph_gh_client is None:
        _graph_gh_client = Github(os.getenv("GITHUB_TOKEN"), retry=GithubRetry(total=0))
    return _graph_gh_client


def _get_repo_files_fast(repo_name: str) -> list[str]:
    """Fetch the repo's full file listing with ONE GitHub API call via the
    Git Trees API (?recursive=1), instead of get_repo_files' one-call-per-
    directory walk. That walk is the documented cause of multi-minute waits
    on large repos (handoff.md §2.2/§6.4) — for expressjs/express-sized
    repos it can be 50-100+ sequential calls before any filtering happens.
    The Trees API returns the entire tree in one round-trip (plus one call
    to resolve the default branch's commit sha), then filtering/capping
    happens locally exactly as before.

    Falls back to get_repo_files on any error (including GitHub's own
    truncation of extremely large trees, where `tree.truncated` is True) so
    behavior never regresses below what already worked — this is a speed
    path, not a replacement contract.
    """
    g = _get_graph_gh_client()
    repo = g.get_repo(repo_name)
    branch = repo.get_branch(repo.default_branch)
    tree = repo.get_git_tree(branch.commit.sha, recursive=True)
    if tree.truncated:
        raise RuntimeError(f"git tree truncated for {repo_name}; falling back to slow walk")

    files: list[str] = []
    for entry in tree.tree:
        if entry.type != "blob":
            continue
        if any(skip in entry.path for skip in _GRAPH_SKIP_DIRS):
            continue
        if any(entry.path.endswith(ext) for ext in _GRAPH_SKIP_EXTENSIONS):
            continue
        files.append(entry.path)
    return files


def _repo_root_id(repo_name: str) -> str:
    return f"repo:{repo_name}"


def _dir_id(repo_name: str, dir_path: str) -> str:
    return f"dir:{repo_name}:{dir_path}"


def _file_id(repo_name: str, file_path: str) -> str:
    return f"file:{repo_name}:{file_path}"


def _build_fs_graph(repo_name: str) -> tuple[list[GraphNode], list[GraphLink], int]:
    """Build Repository/Directory/File nodes + CONTAINS links from real
    GitHub file paths via mcp_server.github_client.get_repo_files.

    Returns (nodes, links, file_count). Never raises — callers get an
    empty ([], [], 0) on any GitHub API failure so the endpoint can still
    return a valid (if minimal) graph rather than a 500.
    """
    root_id = _repo_root_id(repo_name)
    nodes: list[GraphNode] = [
        GraphNode(id=root_id, name=repo_name, type="Repository", val=3.0)
    ]
    links: list[GraphLink] = []

    try:
        file_paths = _get_repo_files_fast(repo_name)
    except Exception as fast_exc:
        logger.warning("fast tree fetch failed for %s (%s); falling back to get_repo_files", repo_name, fast_exc)
        try:
            file_paths = get_repo_files(repo_name)
        except Exception:
            logger.exception("get_repo_files fallback also failed for %s; returning root-only graph", repo_name)
            return nodes, links, 0

    # Deterministic cap: first N by sorted path.
    file_paths = sorted(file_paths)[:GRAPH_MAX_FS_NODES]

    dir_ids: set[str] = set()

    def _ensure_dir_chain(dir_path: str) -> str:
        """Ensure Directory nodes exist for every segment of dir_path,
        linked CONTAINS to their parent (or the repo root). Returns the
        id of the deepest directory node (or the repo root if dir_path
        is empty, i.e. a top-level file)."""
        if not dir_path:
            return root_id
        parts = dir_path.split("/")
        parent_id = root_id
        built = ""
        for part in parts:
            built = f"{built}/{part}" if built else part
            this_id = _dir_id(repo_name, built)
            if this_id not in dir_ids:
                dir_ids.add(this_id)
                nodes.append(GraphNode(id=this_id, name=part, type="Directory", file=built, val=1.5))
                links.append(GraphLink(source=parent_id, target=this_id, type="CONTAINS"))
            parent_id = this_id
        return parent_id

    for path in file_paths:
        if "/" in path:
            dir_path, file_name = path.rsplit("/", 1)
        else:
            dir_path, file_name = "", path
        parent_id = _ensure_dir_chain(dir_path)
        f_id = _file_id(repo_name, path)
        nodes.append(GraphNode(id=f_id, name=file_name, type="File", file=path, val=1.0))
        links.append(GraphLink(source=parent_id, target=f_id, type="CONTAINS"))

    return nodes, links, len(file_paths)


def _best_effort_file_match(ref: str, file_ids_by_path: dict[str, str]) -> str | None:
    """Best-effort match of an Evidence.ref against known File node paths.
    Only matches if ref looks like a file path referencing a real File
    node we built — never fabricates a match."""
    if not ref:
        return None
    if ref in file_ids_by_path:
        return file_ids_by_path[ref]
    # ref may be a path with a leading "./" or repo-relative prefix noise;
    # also try suffix match (ref ends with a known file path) and the
    # reverse (a known file path ends with ref), both conservative.
    for path, node_id in file_ids_by_path.items():
        if ref == path or ref.endswith(f"/{path}") or path.endswith(f"/{ref}"):
            return node_id
    return None


@router.get("/api/repos/{owner}/{repo}/graph", response_model=RepoGraphResponse)
async def get_repo_graph(owner: str, repo: str) -> RepoGraphResponse:
    """Real-data-only code/evidence graph: Repository -> Directory -> File
    tree from the live GitHub file listing, plus Issue/PullRequest and
    Decision nodes from recorded investigations, linked by real evidence
    refs and real decisions. No AST parsing, no fabricated nodes/links.
    """
    repo_name = f"{owner}/{repo}"

    nodes, links, file_count = _build_fs_graph(repo_name)
    file_ids_by_path: dict[str, str] = {
        n.file: n.id for n in nodes if n.type == "File" and n.file
    }

    investigations = [i for i in db.list_investigations() if i["repo_name"] == repo_name]

    for inv in investigations:
        inv_id = inv["id"]
        kind = inv.get("kind")
        node_type = "PullRequest" if kind == "pr" else "Issue"
        number = inv.get("number")
        title = inv.get("title") or f"#{number}"
        inv_node_id = f"inv:{inv_id}"
        nodes.append(
            GraphNode(
                id=inv_node_id,
                name=f"#{number} {title}".strip(),
                type=node_type,
                val=2.0,
            )
        )

        decision = inv.get("decision")
        decision_node_id: str | None = None
        if decision:
            decision_node_id = f"decision:{inv_id}"
            nodes.append(
                GraphNode(id=decision_node_id, name=decision, type="Decision", val=1.5)
            )
            confidence = inv.get("confidence")
            links.append(
                GraphLink(
                    source=inv_node_id,
                    target=decision_node_id,
                    type="DECIDED",
                    score=confidence,
                )
            )

        try:
            steps = db.get_steps(inv_id)
        except Exception:
            logger.exception("get_steps failed for investigation %s", inv_id)
            steps = []

        for step in steps:
            for ev in step.get("evidence", []):
                ref = ev.get("ref") if isinstance(ev, dict) else None
                if not ref:
                    continue
                matched_file_id = _best_effort_file_match(ref, file_ids_by_path)
                if not matched_file_id:
                    continue
                links.append(
                    GraphLink(
                        source=inv_node_id,
                        target=matched_file_id,
                        type="EVIDENCE",
                        score=ev.get("score") if isinstance(ev, dict) else None,
                    )
                )

    metadata = {
        "repo": repo_name,
        "generated_at": _now_iso(),
        "file_count": file_count,
        "investigation_count": len(investigations),
    }

    return RepoGraphResponse(nodes=nodes, links=links, metadata=metadata)
