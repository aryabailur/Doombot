"""Autonomous repository monitoring (F01) -- the compulsory requirement.

PS-04 marks "Agentic Repository Monitoring" as the one compulsory feature:
the agent must *continuously monitor activity and create subtasks* rather than
wait to be asked. Everything else in the system is reactive to a POST; this is
the part that makes it agentic.

Three subtasks, matching the PS wording:

  investigation   a newly-seen issue gets the full triage graph run on it,
                  which is where duplicate checking and missing-information
                  detection happen
  health          the repository's health metrics are recomputed and appended
                  to the time series, so "health-trend investigations" have a
                  trend to investigate
  index           new issues are added to the RAG index, so the next
                  duplicate check can see them

Runs as an asyncio task inside the API process. Deliberately not a webhook:
webhooks need a public URL and fail on venue wifi, and not a separate cron
process either, because a second process cannot broadcast to the WebSocket
hub that lives in this one.
"""

from __future__ import annotations

import asyncio
import logging
import os

from api import runner, ws
from memory import repo

logger = logging.getLogger(__name__)

# Issues seen in a previous cycle. Held in memory rather than a table: on
# restart the agent re-reads open issues, finds them already investigated in
# SQLite, and skips them -- so persistence buys nothing here.
_seen: set[tuple[str, int]] = set()
_task: asyncio.Task | None = None


def monitored_repos() -> list[str]:
    """Repositories to watch, from DOOMBOT_MONITOR_REPOS (comma-separated)."""
    raw = os.getenv("DOOMBOT_MONITOR_REPOS", "")
    return [name.strip() for name in raw.split(",") if name.strip()]


def interval_seconds() -> int:
    """How often to scan. Floor of 30s to stay well inside GitHub's rate limit."""
    try:
        return max(30, int(os.getenv("DOOMBOT_MONITOR_INTERVAL", "120")))
    except ValueError:
        return 120


def enabled() -> bool:
    """Monitoring is opt-in via configuration.

    It starts investigations on its own, which means real GitHub writes unless
    DEMO_MODE is set. Defaulting it on would mean anyone who runs `uvicorn`
    starts an agent that comments on repositories -- so it stays off until a
    repo is named explicitly.
    """
    return bool(monitored_repos())


async def _already_investigated(repo_name: str, number: int) -> bool:
    """Whether this issue has been investigated before.

    Checked against SQLite rather than only the in-memory set, so a restart
    does not re-investigate everything it already handled -- which would
    re-comment on every open issue.
    """
    for row in repo.list_investigations():
        if row["repo_name"] == repo_name and row["number"] == number:
            return True
    return False


async def _scan_repo(repo_name: str) -> None:
    """One monitoring cycle for one repository."""
    from mcp_server.github_client import get_issues

    from api.health import compute_and_record

    # --- subtask: refresh the RAG index ---------------------------------
    # Done before investigating, so a new issue can be compared against
    # everything else currently open rather than a stale index.
    try:
        from rag.embedder import index_issues

        await asyncio.to_thread(index_issues, repo_name, "all", 100)
    except Exception:
        logger.exception("index subtask failed for %s", repo_name)

    # --- subtask: health trend -------------------------------------------
    try:
        await asyncio.to_thread(compute_and_record, repo_name)
    except Exception:
        logger.exception("health subtask failed for %s", repo_name)

    # --- subtask: investigate new issues ---------------------------------
    try:
        issues = await asyncio.to_thread(get_issues, repo_name, "open", 25)
    except Exception:
        logger.exception("could not list issues for %s", repo_name)
        return

    for issue in issues:
        key = (repo_name, issue["number"])
        if key in _seen:
            continue
        _seen.add(key)

        if await _already_investigated(repo_name, issue["number"]):
            continue

        await ws.broadcast({
            "type": "activity",
            "data": {
                "ts": issue.get("updated_at", ""),
                "repo_name": repo_name,
                "message": f"Detected #{issue['number']} — starting investigation",
                "severity": "info",
            },
        })

        # Sequential, not gathered. Each investigation makes several Groq and
        # GitHub calls, and the free Groq tier is 8,000 tokens/minute -- firing
        # ten at once would rate-limit every one of them.
        await runner.run_investigation(
            runner.new_investigation_id(), repo_name, "issue", issue["number"]
        )


async def _loop() -> None:
    """Scan every configured repository, forever."""
    repos = monitored_repos()
    logger.info("monitoring %s every %ss", repos, interval_seconds())

    while True:
        for repo_name in monitored_repos():
            try:
                await _scan_repo(repo_name)
            except Exception:
                # One repository failing must not stop the loop -- otherwise a
                # single bad config entry silently ends all monitoring.
                logger.exception("scan failed for %s", repo_name)
        await asyncio.sleep(interval_seconds())


async def start() -> None:
    global _task
    if not enabled():
        logger.info(
            "monitoring off: set DOOMBOT_MONITOR_REPOS=owner/repo to enable"
        )
        return
    _task = asyncio.create_task(_loop())


async def stop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
