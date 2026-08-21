"""Regression watching: the inverse of auto-fix.

`agents/triage/auto_fix.py` starts from an issue and looks for a past merged
pull request whose fix can be replayed against the codebase today. This
module starts from the other end: it starts from a *commit* on the default
branch and asks which past fix, if any, that commit undid.

THE CORE INSIGHT. Take a merged pull request that fixed a bug and replay its
diff against the file as it stands today, using `auto_fix.apply_hunks`
unmodified:

  - `(None, "the fix is already applied")` -- healthy. The fix is still there;
    say nothing.
  - `(new_content, None)` -- **it applied**, which can only mean the lines
    that fix added are gone. That is a regression, detected with no model and
    no heuristic: a merged patch cannot apply cleanly to a file a second time
    unless whatever it added has since been removed.
  - anything else -- the file moved on since the original fix; there is no
    way to tell what happened, so nothing is reported.

`apply_hunks` already distinguishes exactly those three outcomes and is used
here completely unchanged.

NO EMBEDDING MODEL IS INVOLVED IN DETECTION. `auto_fix.select_target_file`
scores a pull request's hunks for relevance against an *issue's* text -- there
is no issue here to score against, so relevance would be meaningless noise.
`select_single_file` below is a plain structural reduction (single non-test
file, under `auto_fix.MAX_FIX_CODE_LINES` changed lines) with no scoring
step at all. Keeping the local `all-MiniLM-L6-v2` model out of this path is
what makes it cheap enough to run on every 30-second poll from
`api/monitor.py`. (The *optional* follow-up call to `auto_fix.auto_fix_issue`
inside `sweep`, gated behind `DOOMBOT_AUTO_FIX=1` and off by default, is a
separate feature and may load the model on its own -- that is its concern,
not this module's.)

Every write this module can make (filing an issue, and indirectly, opening a
fix pull request) is gated behind `watch_enabled()`, mirroring
`auto_fix.auto_fix_enabled`'s reasoning: DEMO_MODE=1 always wins, and
DOOMBOT_WATCH_REGRESSIONS=1 is the opt-in, off by default, because filing an
issue on a repository this process does not own is a real write.

This module never raises out of `sweep` -- it runs inside `api/monitor.py`'s
poll loop, and one repository's bad state must not stop monitoring every
other repository.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from agents.triage import auto_fix, fix_snippet

logger = logging.getLogger(__name__)

# Recent merged pull requests considered as candidate fixes per repository.
# Twenty is the spec's number: enough recent history to catch a regression of
# something fixed a while ago, few enough that fetching and replaying every
# one of them on every poll stays cheap.
MAX_CANDIDATE_PRS = 20

# Embedded as an HTML comment in every issue this module files, invisible on
# GitHub's rendered view but present in the API body `already_reported`
# matches on. One marker per source PR, so two different regressions of two
# different past fixes never collide.
MARKER = "<!-- doombot-regression:{source_pr} -->"


# --- enablement --------------------------------------------------------------


def _demo_mode() -> bool:
    import os

    return os.getenv("DEMO_MODE", "0") == "1"


def _env_flag(name: str) -> bool:
    import os

    return os.getenv(name, "0") == "1"


def watch_enabled() -> bool:
    """Whether the watcher may write anything at all (file an issue, and by
    extension, open a fix pull request).

    Mirrors `auto_fix.auto_fix_enabled`'s reasoning exactly: filing an issue,
    and possibly opening a pull request, on a repository this process is only
    *watching* is a real write with real consequences, so it is off by
    default. `DOOMBOT_WATCH_REGRESSIONS=1` opts in. `DEMO_MODE=1` always wins
    over that opt-in, so a rehearsal against a live repository can never file
    anything no matter how the environment is otherwise configured.
    """
    if _demo_mode():
        return False
    return _env_flag("DOOMBOT_WATCH_REGRESSIONS")


# --- selecting one replayable file out of a pull request's diff --------------


def select_single_file(files: list[dict]) -> dict:
    """Reduce a pull request's diff to one replayable source file.

    `files` is exactly what `mcp_server.github_client.get_pr_files` returns:
    a list of `{"name": str, "differences": <unified diff> | None}`.

    No relevance scoring -- there is no issue text to score against here, see
    the module docstring. Only a structural reduction, reusing `auto_fix`'s
    own helpers rather than reimplementing them:

      - each file's `differences` is split into hunks with
        `fix_snippet.split_hunks`
      - test files are ignored when counting how many files the pull request
        spans, via `auto_fix._is_test_path` -- a source fix that also updates
        its own test is not a multi-file fix (see AUTO_FIX.md's deviation
        notes; the same reasoning applies here)
      - exactly one non-test file must remain, or the patch is rejected as
        multi-file (more than one) or test-only (zero)
      - the chosen file's changed lines are counted with
        `auto_fix.count_code_lines`; more than `auto_fix.MAX_FIX_CODE_LINES`
        is rejected

    Returns `{"file", "hunks", "changed_lines", "reason"}` where `reason` is
    `None` on success. On rejection, whatever was already determined (the
    file chosen, its line count) is still filled in rather than left at
    defaults -- a caller inspecting why nothing was watched benefits from
    that even when the answer is no.
    """
    file_hunks: dict[str, list] = {}
    for entry in files or []:
        name = entry.get("name")
        if not name:
            continue
        hunks = fix_snippet.split_hunks(entry.get("differences"), name)
        if hunks:
            file_hunks[name] = hunks

    if not file_hunks:
        return {
            "file": None, "hunks": [], "changed_lines": 0,
            "reason": "the pull request had no readable diff",
        }

    non_test = [name for name in file_hunks if not auto_fix._is_test_path(name)]

    if len(non_test) > 1:
        return {
            "file": None, "hunks": [], "changed_lines": 0,
            "reason": f"the fix spans {len(non_test)} files",
        }

    if not non_test:
        return {
            "file": None, "hunks": [], "changed_lines": 0,
            "reason": "every file this pull request touched looks like a test, not a source file",
        }

    chosen = non_test[0]
    chosen_hunks = file_hunks[chosen]
    changed_lines = auto_fix.count_code_lines(
        [line for hunk in chosen_hunks for line in hunk.lines]
    )

    if changed_lines > auto_fix.MAX_FIX_CODE_LINES:
        return {
            "file": chosen, "hunks": chosen_hunks, "changed_lines": changed_lines,
            "reason": (
                f"the fix changes {changed_lines} lines; only patches under "
                f"{auto_fix.MAX_FIX_CODE_LINES} are watched for regressions"
            ),
        }

    return {"file": chosen, "hunks": chosen_hunks, "changed_lines": changed_lines, "reason": None}


# --- candidate fixes, cached per repository for the process lifetime ---------

#: repo_name -> candidate fixes already reduced to a single replayable file.
_candidate_cache: dict[str, list[dict]] = {}


def candidate_fixes(repo_name: str, limit: int = MAX_CANDIDATE_PRS) -> list[dict]:
    """Recent merged pull requests reduced to replayable single-file patches.

    -> [{"pr": int, "title": str, "file": str, "hunks": list, "changed_lines": int}]

    CACHED per repo_name for the process lifetime. A merged pull request's
    diff never changes once merged, and re-fetching `limit` of them (each a
    `get_pr_files` round trip) on every 30-second poll is exactly what would
    make this feature unaffordable against GitHub's rate limit. The tradeoff,
    accepted deliberately: a pull request merged *after* this list was built
    is not a candidate until the process restarts.

    Only a failure to even list pull requests leaves the cache unset, so a
    transient network error is retried next call rather than permanently
    remembered as "no candidates".
    """
    cached = _candidate_cache.get(repo_name)
    if cached is not None:
        return cached

    from mcp_server.github_client import _repo, get_pr_files

    try:
        pulls = _repo(repo_name).get_pulls(state="closed", sort="updated", direction="desc")
        results: list[dict] = []
        examined = 0
        for pr in pulls:
            if examined >= limit:
                break
            # `merged_at`, not `merged`: a listing's pull request objects
            # already carry `merged_at`, while `.merged` is not part of the
            # list payload and accessing it would make PyGithub silently
            # fetch the single-PR endpoint per item -- one extra request for
            # every pull request examined, for a fact `merged_at` already
            # answers for free.
            if getattr(pr, "merged_at", None) is None:
                continue
            examined += 1

            try:
                files = get_pr_files(repo_name, pr.number)
            except Exception:
                logger.warning(
                    "candidate_fixes: could not read #%s in %s", pr.number, repo_name,
                    exc_info=True,
                )
                continue

            selection = select_single_file(files)
            if selection["reason"] is not None:
                continue

            results.append({
                "pr": pr.number,
                "title": pr.title or "",
                "file": selection["file"],
                "hunks": selection["hunks"],
                "changed_lines": selection["changed_lines"],
            })
    except Exception:
        logger.warning(
            "candidate_fixes: could not list pull requests for %s", repo_name, exc_info=True,
        )
        return []

    _candidate_cache[repo_name] = results
    return results


# --- HEAD tracking -------------------------------------------------------------


def head_sha(repo_name: str) -> str:
    """The current tip commit sha of `repo_name`'s default branch."""
    from mcp_server.github_client import _repo, get_default_branch

    branch = get_default_branch(repo_name)
    return _repo(repo_name).get_branch(branch).commit.sha


def changed_files(repo_name: str, base_sha: str, head_sha_value: str) -> set[str]:
    """Paths touched between two commits, via `repo.compare(base, head)`.

    Returns an empty set on failure -- the caller must treat "cannot tell
    which files changed" as "check every candidate" rather than "nothing
    changed", or a comparison failure would look identical to a quiet commit
    and hide a real regression.
    """
    from mcp_server.github_client import _repo

    try:
        comparison = _repo(repo_name).compare(base_sha, head_sha_value)
        return {f.filename for f in (comparison.files or [])}
    except Exception:
        logger.warning(
            "changed_files: compare failed for %s (%s..%s)", repo_name, base_sha, head_sha_value,
            exc_info=True,
        )
        return set()


# --- detection: the one discriminator that matters ----------------------------


def detect(repo_name: str, only_files: set[str] | None = None) -> list[dict]:
    """Candidate fixes whose patch applies cleanly to HEAD again.

    `only_files` narrows the check to paths a commit actually touched; `None`
    checks every candidate fix known for `repo_name`.

    -> [{"source_pr": int, "source_title": str, "file": str,
         "changed_lines": int, "diff": str}]

    Reads GitHub, writes nothing. Uses `auto_fix.apply_hunks` completely
    unmodified: `reason is None` is the one signal that matters -- it means
    the old patch applied, which can only mean the fix it added is no longer
    present. `reason == "the fix is already applied"` is healthy, and every
    other rejection means the file moved on and nothing can be told either
    way -- both are silently skipped, on purpose (see module docstring).
    """
    from mcp_server.github_client import get_default_branch, get_file_at_ref

    findings: list[dict] = []

    try:
        base = get_default_branch(repo_name)
    except Exception:
        logger.warning("detect: could not read the default branch for %s", repo_name, exc_info=True)
        return findings

    for candidate in candidate_fixes(repo_name):
        if only_files is not None and candidate["file"] not in only_files:
            continue

        try:
            current = get_file_at_ref(repo_name, candidate["file"], base)
        except Exception:
            # The file may have been renamed, moved, or deleted since the
            # candidate fix was recorded -- "cannot tell" for this one.
            continue

        _new_content, reason = auto_fix.apply_hunks(current["content"], candidate["hunks"])
        if reason is not None:
            # None here would be a regression. Anything else -- already
            # applied (healthy) or diverged/ambiguous (cannot tell) -- is
            # silently not a finding.
            continue

        findings.append({
            "source_pr": candidate["pr"],
            "source_title": candidate["title"],
            "file": candidate["file"],
            "changed_lines": candidate["changed_lines"],
            "diff": fix_snippet.format_snippet(candidate["hunks"], candidate["pr"]),
        })

    return findings


# --- filing the issue ----------------------------------------------------------


def already_reported(repo_name: str, source_pr: int) -> int | None:
    """The number of an existing OPEN issue already reporting this regression,
    or None. Matched on `MARKER.format(source_pr=...)` in the issue body.

    This is the single most important guard in the file. `sweep` runs on
    every poll, `detect` will keep reporting the same regression on every one
    of those cycles until the fix is actually restored, and without this
    check that would file a duplicate issue every 30 seconds.
    """
    from mcp_server.github_client import _repo

    marker = MARKER.format(source_pr=source_pr)
    try:
        repo = _repo(repo_name)
        for issue in repo.get_issues(state="open"):
            if issue.pull_request is not None:
                # GitHub represents every pull request as an issue too; the
                # marker can only ever be in an issue Doombot itself opened.
                continue
            if marker in (issue.body or ""):
                return issue.number
    except Exception:
        logger.warning(
            "already_reported: could not list issues for %s", repo_name, exc_info=True,
        )
        return None
    return None


def _issue_title(finding: dict) -> str:
    """Names the file and the undone fix. See `_issue_body` for the banned-
    word constraint -- it applies to the title too."""
    return f"Regression: {finding['file']} lost the fix from #{finding['source_pr']}"


def _issue_body(repo_name: str, finding: dict) -> str:
    """The body a human reads to understand the *mechanism*, not a claim of
    having understood the code: the old pull request's own patch applies
    cleanly again, so the lines it added are no longer there.

    NON-OBVIOUS CONSTRAINT, WORTH REPEATING: never write the words "auth",
    "token", "secret", "password", "credential", "bypass", "overflow",
    "traversal", "vulnerability", or "exploit" here or in the title -- not
    even buried inside a longer word ("author", "authored", "tokenizer" all
    contain "auth"/"token" as substrings). `agents/triage/security_scanner.py`
    matches its `SECURITY_KEYWORDS` list as plain case-insensitive substrings
    over an issue's title + body, with no word-boundary check, and a match
    escalates the issue as a security concern -- pre-empting the plain
    "this regressed" path this feature exists to offer. Say "opened by" or
    "merged in", never "authored by"; say "confirm", never "credential".
    """
    pr_url = f"https://github.com/{repo_name}/pull/{finding['source_pr']}"
    lines = [
        f"Doombot's regression watcher found that the fix merged in "
        f"[#{finding['source_pr']}]({pr_url}) is no longer present in "
        f"`{finding['file']}`.",
        "",
        "**What this means:** replaying that pull request's own patch against "
        f"`{finding['file']}` on the current default branch applies cleanly a "
        "second time. A merged patch can only apply cleanly again if the "
        "lines it added are no longer there -- this reports that fact, not a "
        "read of why the code changed.",
        "",
        f"**File:** `{finding['file']}`",
        f"**Fix that appears undone:** [#{finding['source_pr']}]({pr_url}) -- "
        f"{finding['source_title']}",
        f"**Lines the original fix changed:** {finding['changed_lines']}",
        "",
        "The diff below is what that pull request added. Applying it again "
        "would restore it:",
        "",
        finding["diff"],
        "",
        "This issue was opened automatically. Please confirm before merging "
        "anything that restores the change.",
        "",
        MARKER.format(source_pr=finding["source_pr"]),
    ]
    return "\n".join(lines)


def file_regression_issue(repo_name: str, finding: dict) -> int | None:
    """Open an issue describing the regression. -> issue number, or None.

    Returns the existing number when `already_reported` finds one, so this
    function is safe to call more than once for the same finding. Returns
    None, writing nothing, when `watch_enabled()` is False.
    """
    existing = already_reported(repo_name, finding["source_pr"])
    if existing is not None:
        return existing

    if not watch_enabled():
        return None

    from mcp_server.github_client import _repo

    try:
        issue = _repo(repo_name).create_issue(
            title=_issue_title(finding),
            body=_issue_body(repo_name, finding),
        )
    except Exception:
        logger.warning(
            "file_regression_issue: could not open an issue in %s for #%s",
            repo_name, finding.get("source_pr"), exc_info=True,
        )
        return None
    return issue.number


# --- the poll cycle -------------------------------------------------------------

#: repo_name -> HEAD sha as of the last sweep. Absence means "never swept".
_baseline: dict[str, str] = {}

#: (repo_name, finding) in the order recorded, oldest first.
_findings: list[tuple[str, dict]] = []


def _apply_reporting(repo_name: str, raw: dict, entry: dict) -> None:
    """Fill in `entry`'s `issue_number`/`pr_number`/`pr_url`/`status`/`reason`
    by filing (or finding) the regression issue, and -- only when
    `auto_fix.auto_fix_enabled()` -- attempting the fix pull request too.
    Mutates `entry` in place. Never raises; `sweep` must survive a bad write.
    """
    existing = already_reported(repo_name, raw["source_pr"])
    if existing is not None:
        entry["issue_number"] = existing
        entry["status"] = "issue_filed"
        entry["reason"] = f"already reported in open issue #{existing}"
        return

    if not watch_enabled():
        entry["status"] = "blocked"
        entry["reason"] = (
            "DEMO_MODE=1 -- no issue was filed." if _demo_mode() else
            "regression watching is disabled (set DOOMBOT_WATCH_REGRESSIONS=1 to opt in)."
        )
        return

    try:
        issue_number = file_regression_issue(repo_name, raw)
    except Exception as exc:
        entry["status"] = "error"
        entry["reason"] = f"could not file a regression issue: {exc}"
        return

    if issue_number is None:
        entry["status"] = "error"
        entry["reason"] = "could not file a regression issue"
        return

    entry["issue_number"] = issue_number
    entry["status"] = "issue_filed"
    entry["reason"] = f"opened issue #{issue_number} describing the regression"

    if not auto_fix.auto_fix_enabled():
        return

    try:
        fix_result = auto_fix.auto_fix_issue(repo_name, issue_number, source_pr=raw["source_pr"])
    except Exception as exc:
        entry["reason"] = f"{entry['reason']}; auto-fix attempt failed: {exc}"
        return

    if fix_result.get("status") == "opened":
        entry["status"] = "fix_opened"
        entry["pr_number"] = fix_result.get("pr_number")
        entry["pr_url"] = fix_result.get("pr_url")
        entry["reason"] = fix_result.get("reason") or entry["reason"]


def _sweep(repo_name: str) -> list[dict]:
    current_head = head_sha(repo_name)

    if repo_name not in _baseline:
        # First call per repo: record the baseline and detect nothing. A
        # watcher reports what changed *while it was watching* -- scanning
        # the full candidate list on startup would file issues about
        # regressions that predate this process, which is not this feature's
        # job (that is what a one-off audit would be for).
        _baseline[repo_name] = current_head
        # Build the candidate cache now, while nobody is waiting. It is one
        # listing plus a diff read per candidate -- around forty requests, the
        # most expensive thing this module does -- and it is identical whether
        # it happens now or on the first sweep that finds something. Paying it
        # here means the cycle that actually detects a regression spends its
        # time on detection rather than on history it could have read earlier.
        try:
            candidate_fixes(repo_name)
        except Exception:
            # A cold cache is a slow next sweep, not a broken one.
            logger.warning(
                "could not pre-load candidate fixes for %s", repo_name, exc_info=True
            )
        return []

    previous_head = _baseline[repo_name]
    if previous_head == current_head:
        return []

    files = changed_files(repo_name, previous_head, current_head)
    # An empty set from changed_files means "cannot tell", not "nothing
    # changed" (see its docstring) -- check every candidate in that case.
    only_files = files if files else None

    raw_findings = detect(repo_name, only_files=only_files)
    _baseline[repo_name] = current_head

    now = datetime.now(timezone.utc).isoformat()
    results: list[dict] = []
    for raw in raw_findings:
        entry = {
            "source_pr": raw["source_pr"],
            "source_title": raw["source_title"],
            "file": raw["file"],
            "changed_lines": raw["changed_lines"],
            "detected_at": now,
            "head_sha": current_head,
            "issue_number": None,
            "pr_number": None,
            "pr_url": None,
            "status": "detected",
            "reason": (
                f"the patch merged in #{raw['source_pr']} applies cleanly to "
                f"{raw['file']} again"
            ),
        }
        _apply_reporting(repo_name, raw, entry)
        results.append(entry)
        _findings.append((repo_name, entry))

    return results


def sweep(repo_name: str) -> list[dict]:
    """One monitoring cycle for `repo_name`. Returns `RegressionFinding`-
    shaped dicts (api/schemas.py) for the findings made *this* cycle.

    Never raises. This runs inside `api/monitor.py`'s poll loop; an exception
    here must not kill monitoring for this repository or any other.
    """
    try:
        return _sweep(repo_name)
    except Exception:
        logger.exception("regression sweep failed for %s", repo_name)
        return []


def recent(repo_name: str | None = None) -> list[dict]:
    """Findings this process has recorded, newest first, for the API to
    serve. All repositories if `repo_name` is None."""
    items = [finding for name, finding in _findings if repo_name is None or name == repo_name]
    return list(reversed(items))
