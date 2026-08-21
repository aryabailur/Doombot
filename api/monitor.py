"""Autonomous repository monitoring (F01) -- the compulsory requirement.

PS-04 marks "Agentic Repository Monitoring" as the one compulsory feature:
the agent must *continuously monitor activity and create subtasks* rather than
wait to be asked. Everything else in the system is reactive to a POST; this is
the part that makes it agentic.

Four subtasks, matching the PS wording:

  regression      every past merged fix is replayed against the repository's
                  current state; anything found to have been undone is filed
                  as a new issue this same cycle
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
import time

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


def regression_interval_seconds() -> int:
    """How often to run the regression check on its own, between full scans.

    Defaults to `interval_seconds()`, so an unconfigured deployment behaves
    exactly as before: one cadence, everything together.

    Floor of 5s rather than 30s because this subtask is not the expensive one.
    A full cycle re-indexes the backlog and recomputes health -- roughly ten
    GitHub requests, which at a 10s cadence would be ~4300/hour against a
    5000/hour quota shared with investigations and the code graph. The
    regression check, when HEAD has not moved, is a single `get_branch` call:
    one request, returning immediately. Running only that every few seconds
    costs ~720/hour, and is the difference between noticing a commit in
    seconds and noticing it after a full interval.
    """
    try:
        configured = int(os.getenv("DOOMBOT_REGRESSION_INTERVAL", "0"))
    except ValueError:
        return interval_seconds()
    if configured <= 0:
        return interval_seconds()
    return max(5, configured)


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


async def check_regressions(repo_name: str) -> list[dict]:
    """The regression subtask on its own, so it can run between full scans.

    Cheap by design: when the default branch has not moved this is one
    `get_branch` call and an immediate return, which is what makes it safe to
    call every few seconds (see `regression_interval_seconds`).

    Never raises -- it is called from the poll loop, where an exception would
    end monitoring for every repository, not only this one.
    """
    try:
        from agents.triage.regression import sweep

        findings = await asyncio.to_thread(sweep, repo_name)
    except Exception:
        logger.exception("regression subtask failed for %s", repo_name)
        return []

    for finding in findings:
        await ws.broadcast({
            "type": "activity",
            "data": {
                "ts": finding.get("detected_at", ""),
                "repo_name": repo_name,
                "message": (
                    f"Regression in {finding.get('file', '?')} — the fix from "
                    f"#{finding.get('source_pr', '?')} is no longer present"
                ),
                "severity": "warning",
            },
        })
    return findings


async def _scan_repo(repo_name: str) -> None:
    """One monitoring cycle for one repository."""
    from mcp_server.github_client import get_issues

    from api.health import compute_and_record

    # --- subtask: regressions --------------------------------------------
    # Runs first, ahead of both index and investigate. If it files an issue,
    # that issue needs to reach the *other* two subtasks in this same cycle,
    # not the next one:
    #   - before investigate, so the investigate subtask below picks up the
    #     freshly filed issue in this pass -- detect, file and investigate
    #     complete together instead of the issue sitting for a full interval
    #     before anything looks at it.
    #   - before index, so this cycle's indexing embeds the new issue rather
    #     than leaving it invisible to duplicate checks until the next scan.
    await check_regressions(repo_name)

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

    # Two cadences, not one. A full scan re-indexes the backlog, recomputes
    # health and investigates new issues -- affordable every 30s or more, not
    # every 5s. The regression check is a single request when nothing has
    # changed, so it runs in between.
    #
    # With DOOMBOT_REGRESSION_INTERVAL unset the two cadences are equal and
    # this behaves exactly as the single-cadence loop it replaced.
    last_full = 0.0
    while True:
        due_full = (time.monotonic() - last_full) >= interval_seconds()
        for repo_name in monitored_repos():
            try:
                if due_full:
                    await _scan_repo(repo_name)
                else:
                    await check_regressions(repo_name)
            except Exception:
                # One repository failing must not stop the loop -- otherwise a
                # single bad config entry silently ends all monitoring.
                logger.exception("scan failed for %s", repo_name)
        if due_full:
            last_full = time.monotonic()
        await asyncio.sleep(regression_interval_seconds())


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
