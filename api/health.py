"""Project health analysis (F10) -- a compulsory PS-04 feature.

PS-04 asks for tracked "response time, backlog growth, duplicate rate,
contributor activity, and other trends". This computes them from real GitHub
data and appends a point to the time series, so the dashboard's trend chart
plots measurements rather than fixtures.

Four sub-scores, each 0-100 and higher-is-better, because the SQLite schema
and the API contract are both fixed on those four columns:

    responsiveness   how fast issues get a first reply
    staleness        backlog growth -- open issues going unanswered
    duplication      how much of the backlog is duplicate reports
    security         unresolved security escalations

Every sub-score is capped and floored, so one pathological repository cannot
produce a score outside 0-100 and break the chart's axis.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from memory import repo

logger = logging.getLogger(__name__)

# Weights sum to 1.0. Security is heaviest because an unreviewed vulnerability
# is the single worst state a repository can be in, and responsiveness next
# because PS-04 names response time first.
WEIGHTS = {
    "security": 0.30,
    "responsiveness": 0.30,
    "staleness": 0.25,
    "duplication": 0.15,
}


def _clamp(value: float) -> float:
    return max(0.0, min(100.0, value))


def _age_days(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - parsed).total_seconds() / 86400.0


def _responsiveness(issues: list[dict]) -> float:
    """Share of open issues that have any reply at all.

    A comment count is a crude proxy for first-response time -- measuring the
    real interval needs a per-issue comment fetch, which costs one API call per
    issue and would exhaust the rate limit on a busy repo. "Has anyone replied"
    captures the signal PS-04 cares about at a fraction of the cost.
    """
    open_issues = [i for i in issues if i.get("state") == "open"]
    if not open_issues:
        return 100.0
    answered = sum(1 for i in open_issues if (i.get("comments") or 0) > 0)
    return _clamp(answered / len(open_issues) * 100.0)


def _staleness(issues: list[dict]) -> float:
    """Backlog freshness: penalises open issues left sitting.

    Scored on the *median* age rather than the mean, so one ancient
    never-closed issue cannot drag an otherwise healthy repo to zero.
    """
    ages = [
        age
        for age in (_age_days(i.get("created_at")) for i in issues if i.get("state") == "open")
        if age is not None
    ]
    if not ages:
        return 100.0
    ages.sort()
    median = ages[len(ages) // 2]
    # 0 days -> 100, 90 days -> 0, linear in between.
    return _clamp(100.0 - (median / 90.0) * 100.0)


def _duplication(repo_name: str, issues: list[dict]) -> float:
    """Share of open issues the agent flagged as duplicates.

    Read from the investigations already run rather than by re-embedding
    everything: the triage graph has done this work, and recomputing it here
    would duplicate the duplicate detector.
    """
    open_count = sum(1 for i in issues if i.get("state") == "open")
    if open_count == 0:
        return 100.0
    dupes = sum(
        1
        for row in repo.list_investigations()
        if row["repo_name"] == repo_name and row.get("decision") == "close_duplicate"
    )
    return _clamp(100.0 - (dupes / open_count) * 100.0)


def _security(repo_name: str) -> float:
    """Penalises unresolved security escalations.

    Each open critical escalation costs 25 points, so four outstanding
    vulnerabilities take this to zero. Deliberately steep -- a repository with
    several unreviewed security reports is not in acceptable health.
    """
    open_escalations = [
        row
        for row in repo.list_escalations(resolved=False)
        if row["repo_name"] == repo_name and row["severity"] == "critical"
    ]
    return _clamp(100.0 - len(open_escalations) * 25.0)


# Short-lived cache of computed health, keyed by repo.
#
# Computing it costs a GitHub round trip -- measured at ~7.7s on a live repo,
# because it lists up to 100 issues. The dashboard polls this endpoint, and a
# page with three health widgets would otherwise trigger three identical
# multi-second fetches. 60s is well under the monitoring interval, so a cached
# value is never more stale than the data behind it.
_CACHE_TTL = 60.0
_cache: dict[str, tuple[float, dict]] = {}


def compute(repo_name: str, use_cache: bool = True) -> dict:
    """Compute the four sub-scores and the weighted overall score.

    Returns the same shape `HealthResponse.breakdown` expects. Never raises:
    if GitHub is unreachable the caller still gets a usable structure, because
    a monitoring cycle must not die on a health check.
    """
    if use_cache:
        cached = _cache.get(repo_name)
        if cached and (time.monotonic() - cached[0]) < _CACHE_TTL:
            return cached[1]

    unreadable = False
    try:
        from mcp_server.github_client import get_issues

        issues = get_issues(repo_name, "all", 100)
    except Exception:
        logger.exception("health: could not fetch issues for %s", repo_name)
        issues = []
        # "We could not read the issues" and "there are no issues" produce the
        # same empty list and are completely different facts. Conflating them
        # tells a user their busy repository is empty -- which is what happened
        # under an exhausted GitHub quota.
        unreadable = True

    breakdown = {
        "security": _security(repo_name),
        "responsiveness": _responsiveness(issues),
        "staleness": _staleness(issues),
        "duplication": _duplication(repo_name, issues),
    }
    score = sum(breakdown[key] * WEIGHTS[key] for key in WEIGHTS)

    # A repository with no issues at all has no measured health.
    #
    # Three of the four sub-scores return 100.0 for an empty backlog, since
    # "no stale issues" and "no unanswered issues" are literally true. Summed,
    # that reported a confident 100/100 for a repository the agent had never
    # been able to look at -- indistinguishable from a genuinely pristine
    # project, and the single most misleading number the dashboard could show.
    # `measured: False` lets the UI say "not enough data" instead of inventing
    # a perfect score.
    measured = bool(issues)
    result = {
        "score": round(score, 1),
        "breakdown": breakdown,
        "measured": measured,
        "issue_count": len(issues),
        "unreadable": unreadable,
    }
    if not unreadable:
        # Deliberately not cached: a failure caused by a rate limit would
        # otherwise be served for the full TTL after the quota recovered.
        _cache[repo_name] = (time.monotonic(), result)
    return result


def compute_and_record(repo_name: str) -> dict:
    """Compute health and append it to the time series.

    Called by the monitoring loop, which is what turns a single number into the
    trend PS-04 asks for -- one measurement is not a trend.
    """
    # Never cached: the whole point of a recorded point is that it is a new
    # measurement, and a cached one would flatten the trend.
    result = compute(repo_name, use_cache=False)
    breakdown = result["breakdown"]
    try:
        repo.record_health_score(
            repo_name=repo_name,
            score=result["score"],
            security=breakdown["security"],
            staleness=breakdown["staleness"],
            duplication=breakdown["duplication"],
            responsiveness=breakdown["responsiveness"],
        )
    except Exception:
        logger.exception("health: could not record score for %s", repo_name)
    return result
