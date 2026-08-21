"""Auto-Fix PRs: replay a known fix, do not invent one.

This module calls no LLM, and that is the point of the feature rather than a
limitation of it. By the time anything here runs, `agents/triage/resolver.py`
has already found a previously closed issue that plausibly matches the new
one and a pull request that actually fixed it -- `find_fix_pr` and
`extract_fix_snippet` in `agents/triage/fix_snippet.py` do exactly that, to
inline a snippet in a resolver reply. Auto-fix goes one step further: instead
of just quoting that diff, it mechanically checks whether the exact lines the
old fix touched are still there, unmoved, in the file on the current default
branch, and if so, replays the change and opens a draft pull request for a
human to review.

There is nothing here that writes code that didn't already exist and didn't
already work somewhere else in this repository's own history. If the context
around the old fix has moved even slightly, or two locations look identical,
or the fix is already applied, the answer is "not applicable" -- never a
best-effort guess dressed up as a patch. A wrong autonomous PR against a
stranger's repository costs more trust than no PR at all.

Small patches only, single-file fixes only, and the write is gated behind
`DEMO_MODE` and `DOOMBOT_AUTO_FIX` exactly the way `resolver.auto_post_enabled`
gates its own riskiest write -- see `auto_fix_enabled` below.
"""

from __future__ import annotations

from agents.triage import fix_snippet

# AUTO_FIX.md "Small patches only": a patch whose selected file changes more
# than this many real code lines is reported as not applicable rather than
# opened, however clean the context match is.
MAX_FIX_CODE_LINES = 20

# Every fix branch this feature creates uses this prefix, keyed by issue
# number, so a re-run finds the branch it (or a prior run) already made
# instead of guessing at a name.
BRANCH_PREFIX = "doombot/fix-"

# A line whose stripped text starts with one of these is comment, not code,
# for the purposes of MAX_FIX_CODE_LINES. Order does not matter for a tuple
# startswith check.
_COMMENT_PREFIXES = ("#", "//", "/*", "*/", "*", "--")

# A line that is only a triple-quote delimiter (the open or close of a
# docstring) carries no code of its own either.
_TRIPLE_QUOTES = ('"""', "'''")


def auto_fix_enabled() -> bool:
    """Whether the *graph* may open a fix PR unattended, with no human in
    the loop that run.

    Mirrors `resolver.auto_post_enabled` exactly, including the reasoning:
    opening a pull request under the project's name is a real write with
    real consequences for a stranger's repository, so it is off by default.
    `DOOMBOT_AUTO_FIX=1` opts in. `DEMO_MODE=1` always wins over that opt-in,
    so a rehearsal against a live repository can never open a real PR no
    matter how the environment is otherwise configured.
    """
    if _demo_mode():
        return False
    return _env_flag("DOOMBOT_AUTO_FIX")


def writes_allowed() -> bool:
    """Whether *any* GitHub write may happen at all, on any path.

    False only when `DEMO_MODE=1`. This is deliberately a weaker gate than
    `auto_fix_enabled`: a maintainer explicitly asking the on-demand path
    ("open a fix PR for issue #42") for a fix PR is itself the authorization
    that path needs -- it is a human asking, not the graph deciding on its
    own -- so that path checks this function and not `auto_fix_enabled`.
    `DEMO_MODE=1` still overrides even an explicit human request, because a
    demo must never be able to write to the repository being shown, no
    matter what button was clicked.
    """
    return not _demo_mode()


def _demo_mode() -> bool:
    import os

    return os.getenv("DEMO_MODE", "0") == "1"


def _env_flag(name: str) -> bool:
    import os

    return os.getenv(name, "0") == "1"


def count_code_lines(diff_lines: list[str]) -> int:
    """Added/removed lines that are neither blank nor comment-only.

    AUTO_FIX.md counts "actual code changes (not counting blank lines or
    comments)". Only `+`/`-` marked lines are candidates at all -- context
    lines, the `@@` header, and a `\\ No newline at end of file` marker are
    never code changes and are skipped by construction, since none of them
    start with `+` or `-`. A `+++`/`---` file-header line is excluded
    explicitly in case a caller passes raw patch text rather than a single
    hunk's body.
    """
    count = 0
    for line in diff_lines:
        if not line or line[0] not in ("+", "-"):
            continue
        if line.startswith(("+++", "---")):
            continue
        text = line[1:].strip()
        if not text:
            continue
        if text.startswith(_COMMENT_PREFIXES):
            continue
        if text in _TRIPLE_QUOTES:
            continue
        count += 1
    return count


def _is_test_path(path: str) -> bool:
    """Whether `path` looks like a test file rather than the source it tests.

    AUTO_FIX.md's "single-file fixes only" guardrail exists to keep a patch
    reviewable in one glance, not to reject the extremely common shape of a
    source fix that also updates its own test -- rejecting those would
    reject most real fixes. So a test file is ignored when counting how many
    *files* the fix spans.

    Matched on path *segments* and filename conventions, not a substring
    search. `"test" in path` also matches `latest.py`, `contest.py` and
    `attestation.py`, and misreading a source file as a test is the dangerous
    direction of that error: it would let a genuinely two-file fix past the
    single-file guardrail by discounting one of the files as a test.
    """
    segments = path.lower().replace("\\", "/").split("/")
    basename = segments[-1]
    if any(part in ("test", "tests", "spec", "specs", "__tests__") for part in segments[:-1]):
        return True
    stem = basename.rsplit(".", 1)[0]
    return (
        stem.startswith(("test_", "spec_"))
        or stem.endswith(("_test", "_spec", ".test", ".spec"))
    )


def select_target_file(files: list[dict], issue_text: str) -> dict:
    """AUTO_FIX.md's "single-file fixes only" guardrail plus relevance.

    `files` is exactly what `mcp_server.github_client.get_pr_files` returns.
    Every file's hunks are split and scored together against `issue_text` in
    one `fix_snippet.score_hunks` call (scoring is per-hunk regardless of how
    many hunks come from how many files); a file's relevance is the best
    score among its own hunks.

    Non-test files above `fix_snippet.HUNK_RELEVANCE_THRESHOLD` are the ones
    that count toward "how many files does this fix touch": more than one
    means the fix is genuinely multi-file and is rejected. Exactly one is the
    target.

    A fix confined to test files alone -- no source file cleared the bar -- is
    also rejected. AUTO_FIX.md's guardrail is phrased in terms of the number of
    files, but replaying a test-only change would open a pull request that edits
    an assertion and repairs nothing, presented with the same confidence as a
    real fix. That is the failure this module exists to refuse.

    Returns `{"file", "hunks", "relevance", "changed_lines", "reason"}` where
    `reason` is `None` on success and a human sentence otherwise. On
    rejection, whatever was already determined (the file considered, the
    line count) is still filled in rather than left at defaults, since a
    caller deciding whether to retry, or a maintainer reading why nothing
    was opened, benefits from that even when the answer is no.
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
            "file": None, "hunks": [], "relevance": 0.0, "changed_lines": 0,
            "reason": "the pull request had no readable diff",
        }

    all_hunks = [hunk for hunks in file_hunks.values() for hunk in hunks]
    # Attribute lookup on the module, not a name bound at import time, so a
    # caller (a test, in particular) can monkeypatch
    # `agents.triage.fix_snippet.score_hunks` and have it take effect here --
    # `from ... import score_hunks` would have bound a reference this
    # function keeps using even after the module attribute is replaced.
    scored = fix_snippet.score_hunks(all_hunks, issue_text)
    relevance_by_id = {id(hunk): score for hunk, score in scored}

    def best_relevance(hunks: list) -> float:
        return max((relevance_by_id.get(id(hunk), 0.0) for hunk in hunks), default=0.0)

    file_relevance = {name: best_relevance(hunks) for name, hunks in file_hunks.items()}

    above = {
        name: score for name, score in file_relevance.items()
        if score >= fix_snippet.HUNK_RELEVANCE_THRESHOLD
    }
    if not above:
        top = max(file_relevance.values(), default=0.0)
        return {
            "file": None, "hunks": [], "relevance": top, "changed_lines": 0,
            "reason": f"no part of the diff cleared {fix_snippet.HUNK_RELEVANCE_THRESHOLD:.2f} relevance",
        }

    non_test_above = [name for name in above if not _is_test_path(name)]
    if len(non_test_above) > 1:
        return {
            "file": None, "hunks": [], "relevance": max(above.values()), "changed_lines": 0,
            "reason": f"the fix spans {len(non_test_above)} files",
        }

    if not non_test_above:
        # Only test files cleared the relevance bar, so the part of that pull
        # request which relates to this issue is a test, not a fix. Replaying
        # it would open a pull request that changes an assertion and repairs
        # nothing -- and does so with the confident framing of a real fix,
        # which is the exact failure this whole module is built to avoid.
        return {
            "file": None, "hunks": [], "relevance": max(above.values()),
            "changed_lines": 0,
            "reason": "the only relevant part of the fix is in a test file, not in the source",
        }

    chosen = non_test_above[0]
    chosen_hunks = file_hunks[chosen]
    changed_lines = count_code_lines(
        [line for hunk in chosen_hunks for line in hunk.lines]
    )

    if changed_lines > MAX_FIX_CODE_LINES:
        return {
            "file": chosen, "hunks": chosen_hunks, "relevance": above[chosen],
            "changed_lines": changed_lines,
            "reason": (
                f"the fix changes {changed_lines} lines; only patches under "
                f"{MAX_FIX_CODE_LINES} are applied automatically"
            ),
        }

    return {
        "file": chosen, "hunks": chosen_hunks, "relevance": above[chosen],
        "changed_lines": changed_lines, "reason": None,
    }


def _hunk_blocks(hunk) -> tuple[list[str] | None, list[str] | None]:
    """Split one hunk into its old (pre-patch) and new (post-patch) blocks.

    Returns `(None, None)` the moment a line carries a prefix this project's
    diffs don't use. That rejects the whole patch rather than guessing at
    what an unrecognised marker means -- a silently-wrong guess here is what
    `apply_hunks` exists to avoid.
    """
    old_block: list[str] = []
    new_block: list[str] = []
    for line in hunk.lines:
        if line.startswith("@@") or line.startswith("\\"):
            continue
        if line == "":
            # Some diffs emit a blank context line with no leading space at
            # all, rather than a lone " ".
            old_block.append("")
            new_block.append("")
            continue
        marker, text = line[0], line[1:]
        if marker == " ":
            old_block.append(text)
            new_block.append(text)
        elif marker == "-":
            old_block.append(text)
        elif marker == "+":
            new_block.append(text)
        else:
            return None, None
    return old_block, new_block


def _find_all(haystack: list[str], needle: list[str]) -> list[int]:
    """Every index where `needle` occurs contiguously and exactly in
    `haystack`. No whitespace normalisation -- that strictness *is* the
    "context match required" guardrail; a match that only appears after
    trimming whitespace is a match that no longer holds.
    """
    if not needle:
        return []
    span = len(needle)
    return [
        i for i in range(len(haystack) - span + 1)
        if haystack[i:i + span] == needle
    ]


def apply_hunks(content: str, hunks: list) -> tuple[str | None, str | None]:
    """The patch applicability check AND the application, in one place --
    they are the same computation. This is the heart of the feature.

    Hunks are applied one at a time against the evolving content, re-finding
    the anchor each time, so no line-offset bookkeeping is needed even across
    multiple hunks in the same file.

    Per hunk: an empty old block has nothing to anchor against, so it is
    rejected outright. Zero matches means either the fix is already there
    (the new block is already present -- reported as such, distinct from
    divergence, because a PR that changes nothing is worse than no PR) or the
    surrounding lines changed since the original PR. More than one match is
    ambiguous and rejected rather than guessed at -- applying to the wrong
    one of two identical locations is a silent wrong answer, worse than no
    fix at all. Exactly one match is spliced in.

    The result is rejoined with the file's own dominant newline convention
    and keeps (or does not add) a trailing newline, matching whatever the
    original content did -- rewriting every line ending in a file is a diff
    nobody will merge.

    Returns `(new_content, rejection_reason)`; exactly one is `None`. No
    network, no I/O.
    """
    newline = "\r\n" if "\r\n" in content else "\n"
    trailing_newline = content.endswith("\n") if content else False
    lines = content.splitlines()

    for hunk in hunks:
        old_block, new_block = _hunk_blocks(hunk)
        if old_block is None:
            return None, (
                f"the diff for {hunk.file_path} uses a line format this "
                "project doesn't understand"
            )
        if not old_block:
            return None, f"the hunk for {hunk.file_path} has no context to anchor against"

        matches = _find_all(lines, old_block)

        if len(matches) == 0:
            if new_block and _find_all(lines, new_block):
                return None, "the fix is already applied"
            return None, (
                f"the surrounding lines in {hunk.file_path} have changed "
                "since the original pull request"
            )

        if len(matches) > 1:
            return None, (
                f"the patch location in {hunk.file_path} is ambiguous "
                f"({len(matches)} matching locations)"
            )

        index = matches[0]
        lines = lines[:index] + new_block + lines[index + len(old_block):]

    new_content = newline.join(lines)
    if trailing_newline:
        new_content += newline
    return new_content, None


def _plan_reject(source_pr: int, reason: str, **extra) -> dict:
    result = {
        "applicable": False, "reason": reason, "source_pr": source_pr,
        "file": None, "changed_lines": 0, "relevance": 0.0, "base": None,
        "new_content": None, "file_sha": None, "diff": None,
    }
    result.update(extra)
    return result


def plan_fix(repo_name: str, source_pr: int, issue_text: str) -> dict:
    """AUTO_FIX.md step 2: work out whether #source_pr's fix can be replayed
    against the current default branch. Reads GitHub, writes nothing.

    `reason` is ALWAYS a human sentence, including on success, so a caller
    can show or log it without a separate success-message path. `diff` is
    the selected hunks rendered as a fenced diff block via
    `fix_snippet.format_snippet`, reusing the exact rendering the resolver's
    inline snippet uses.
    """
    from mcp_server.github_client import get_default_branch, get_file_at_ref, get_pr_files

    try:
        files = get_pr_files(repo_name, source_pr)
    except Exception as exc:
        return _plan_reject(source_pr, f"could not read the diff of #{source_pr}: {exc}")

    selection = select_target_file(files, issue_text)
    if selection["reason"] is not None:
        return _plan_reject(
            source_pr, selection["reason"], file=selection["file"],
            changed_lines=selection["changed_lines"], relevance=selection["relevance"],
        )

    file_path = selection["file"]
    hunks = selection["hunks"]

    try:
        base = get_default_branch(repo_name)
    except Exception as exc:
        return _plan_reject(
            source_pr, f"could not read the default branch: {exc}", file=file_path,
            changed_lines=selection["changed_lines"], relevance=selection["relevance"],
        )

    try:
        current = get_file_at_ref(repo_name, file_path, base)
    except Exception as exc:
        return _plan_reject(
            source_pr, f"could not read {file_path} at {base}: {exc}", file=file_path,
            changed_lines=selection["changed_lines"], relevance=selection["relevance"], base=base,
        )

    new_content, rejection = apply_hunks(current["content"], hunks)
    if rejection:
        return _plan_reject(
            source_pr, rejection, file=file_path,
            changed_lines=selection["changed_lines"], relevance=selection["relevance"], base=base,
        )

    diff = fix_snippet.format_snippet(hunks, source_pr)
    changed_lines = selection["changed_lines"]
    plural = "" if changed_lines == 1 else "s"
    reason = (
        f"the fix to {file_path} ({changed_lines} changed line{plural}) "
        f"applies cleanly to {base}"
    )
    return {
        "applicable": True, "reason": reason, "source_pr": source_pr,
        "file": file_path, "changed_lines": changed_lines,
        "relevance": selection["relevance"], "base": base,
        "new_content": new_content, "file_sha": current["sha"], "diff": diff,
    }


def _pr_body(issue_number: int, plan: dict, ci: bool, issue_title: str) -> str:
    """Every element AUTO_FIX.md step 5 lists: a summary, the link to the
    issue being fixed, the link to the original fix PR, the diff, the
    review-before-merging disclaimer, the CI note when applicable, and the
    one-commit-so-reverting-is-trivial note."""
    title_suffix = f" ({issue_title})" if issue_title else ""
    lines = [
        f"Doombot opened this pull request to resolve #{issue_number}{title_suffix}.",
        "",
        f"The patch replays the fix already merged in #{plan['source_pr']}, applied "
        f"to `{plan['file']}` with no changes beyond what that pull request made.",
        "",
        plan.get("diff") or "",
        "",
        "**Please review before merging.** This patch was assembled automatically "
        "by replaying a known fix, not written or verified by a model -- read it the "
        "way you would any other contributor's patch.",
    ]
    if ci:
        lines += [
            "",
            "This repository runs CI on pull requests; this draft is left for those "
            "checks to run before anyone marks it ready for review.",
        ]
    lines += [
        "",
        "Everything here is a single commit, so reverting is a one-step `git revert` "
        "away if it turns out not to apply as cleanly as it looked.",
    ]
    return "\n".join(lines)


def _issue_comment(plan: dict, pr: dict) -> str:
    """AUTO_FIX.md step 6's wording: tell the author a fix has been proposed,
    link the draft PR, and make clear a human still has to merge it. Never
    closes the issue -- that decision belongs to whoever reviews the PR."""
    return (
        f"Doombot opened a draft pull request that applies a known fix for this "
        f"issue: {pr['url']}\n\n"
        f"The patch replays the change already merged in #{plan['source_pr']}. It is "
        "left as a draft for a maintainer to review and merge -- Doombot does not "
        "merge its own pull requests, and this issue is left open until it does.\n\n"
        "<!-- doombot -->"
    )


def _fix_result(status: str, reason: str, **extra) -> dict:
    result = {
        "status": status, "reason": reason, "source_pr": None, "pr_number": None,
        "pr_url": None, "branch": None, "file": None, "changed_lines": 0,
        "ci": False, "commented": False,
    }
    result.update(extra)
    return result


def open_fix_pr(repo_name: str, issue_number: int, plan: dict,
                issue_title: str = "") -> dict:
    """AUTO_FIX.md steps 3-6: branch, commit, draft PR, issue comment.

    A plan that is not applicable is rejected before any of that -- there is
    nothing to write regardless of whether writes are even allowed, so that
    check comes first. `writes_allowed()` comes next: DEMO_MODE must stop
    every write attempt, unconditionally.

    `find_open_pull_request_for_branch` is checked before anything is
    created, so a second run against the same issue is idempotent: if a fix
    PR is already open on this issue's branch, nothing new is written and
    "existing" is returned with that PR's own number and URL.

    Once the branch exists, the file is re-read *on the branch* rather than
    reusing the sha from the base branch. Immediately after `create_branch`
    the two shas name the same commit, so either would work for the first
    write -- re-reading is done anyway so a commit landed on the branch
    between planning and this call (by a human, or a concurrent run) is
    never silently overwritten by `plan["new_content"]` computed against a
    now-stale version.

    A failure after the branch exists still reports the branch name in the
    result, so a maintainer can pick up the fix by hand from there instead
    of it disappearing into an error with no trace.
    """
    branch = f"{BRANCH_PREFIX}{issue_number}"

    if not plan.get("applicable"):
        return _fix_result(
            "not_applicable", plan.get("reason") or "the plan was not applicable.",
            source_pr=plan.get("source_pr"), file=plan.get("file"),
            changed_lines=plan.get("changed_lines") or 0,
        )

    if not writes_allowed():
        return _fix_result(
            "blocked", "DEMO_MODE=1 -- no branch, commit, or pull request was created.",
            source_pr=plan.get("source_pr"), file=plan.get("file"),
            changed_lines=plan.get("changed_lines") or 0,
        )

    from mcp_server.github_client import (
        commit_file,
        create_branch,
        create_draft_pull_request,
        find_open_pull_request_for_branch,
        get_file_at_ref,
        has_ci_workflows,
        post_issue_comment,
    )

    common = {
        "source_pr": plan.get("source_pr"), "file": plan.get("file"),
        "changed_lines": plan.get("changed_lines") or 0,
    }

    try:
        existing = find_open_pull_request_for_branch(repo_name, branch)
    except Exception as exc:
        return _fix_result(
            "error", f"could not check for an existing pull request on {branch}: {exc}",
            branch=branch, **common,
        )

    if existing:
        return _fix_result(
            "existing", f"a fix pull request is already open on {branch}.",
            pr_number=existing["number"], pr_url=existing["url"], branch=branch, **common,
        )

    try:
        create_branch(repo_name, branch)
    except Exception as exc:
        return _fix_result(
            "error", f"could not create branch {branch}: {exc}", branch=branch, **common,
        )

    try:
        current = get_file_at_ref(repo_name, plan["file"], branch)
    except Exception as exc:
        return _fix_result(
            "error",
            f"branch {branch} was created but {plan['file']} could not be re-read on it: {exc}",
            branch=branch, **common,
        )

    message = f"fix: apply patch from PR #{plan['source_pr']} to resolve #{issue_number}"
    try:
        commit_file(repo_name, plan["file"], plan["new_content"], message, branch, current["sha"])
    except Exception as exc:
        return _fix_result(
            "error", f"branch {branch} exists but the commit failed: {exc}",
            branch=branch, **common,
        )

    try:
        ci = has_ci_workflows(repo_name)
    except Exception:
        ci = False

    title = f"doombot: fix #{issue_number}" + (f" -- {issue_title}" if issue_title else "")
    body = _pr_body(issue_number, plan, ci, issue_title)

    try:
        pr = create_draft_pull_request(repo_name, title, body, branch)
    except Exception as exc:
        return _fix_result(
            "error",
            f"branch {branch} exists and was committed, but opening the pull request failed: {exc}",
            branch=branch, ci=ci, **common,
        )

    commented = False
    try:
        post_issue_comment(repo_name, issue_number, _issue_comment(plan, pr))
        commented = True
    except Exception:
        # The pull request is real even if the comment failed to post; that
        # is not a reason to report the whole operation as an error.
        commented = False

    return _fix_result(
        "opened", f"opened a draft pull request replaying #{plan['source_pr']}'s fix.",
        pr_number=pr["number"], pr_url=pr["url"], branch=branch, ci=ci,
        commented=commented, **common,
    )


def _find_source_pr(repo_name: str, issue_number: int, issue_title: str, issue_text: str) -> int | None:
    """Find #source_pr when the caller doesn't already have one: the closest
    resolved match for this issue, then the pull request that actually fixed
    it.

    Reuses `resolver._find_resolved_match`'s similarity search directly
    rather than re-deriving its threshold and query shape -- it takes a
    `GraphState`-shaped mapping, which is built here from the pieces this
    function already has. A match only counts if the old issue is actually
    closed (an open issue is not "resolved", however similar), and its fix PR
    is found the same way `fix_snippet.extract_fix_snippet` finds one: `#123`
    references in the closing comments and the old issue's own body, most
    recent first.
    """
    from agents.triage.resolver import _find_resolved_match
    from mcp_server.github_client import get_issue, get_issue_comments

    match = _find_resolved_match({
        "repo_name": repo_name,
        "issue_number": issue_number,
        "issue_metadata": {"title": issue_title, "body": issue_text},
    })
    if not match:
        return None

    try:
        old_issue = get_issue(repo_name, match["number"])
    except Exception:
        return None
    if old_issue.get("state") != "closed":
        return None

    try:
        comments = get_issue_comments(repo_name, match["number"])
    except Exception:
        comments = []
    comment_text = "\n".join(c.get("body", "") for c in reversed(comments))

    return fix_snippet.find_fix_pr(repo_name, f"{comment_text}\n{old_issue.get('body', '')}")


def auto_fix_issue(repo_name: str, issue_number: int, source_pr: int | None = None,
                   issue_text: str = "", issue_title: str = "") -> dict:
    """End to end, for the MCP tool and the API route: find a source fix if
    one wasn't given, plan replaying it, and open the draft PR if the plan
    holds up. Never raises -- any exception becomes `status: "error"` so a
    caller that forgot to wrap this in a try/except still gets a well-formed
    result instead of a stack trace.
    """
    try:
        if not issue_text or not issue_title:
            # get_issue_text, not get_issue: the full triage shape costs a
            # second round trip to count participants exactly, and nothing
            # here reads that field.
            from mcp_server.github_client import get_issue_text as get_issue

            try:
                issue = get_issue(repo_name, issue_number)
            except Exception as exc:
                return _fix_result("error", f"could not read issue #{issue_number}: {exc}")
            issue_title = issue_title or issue.get("title", "")
            issue_text = issue_text or f"{issue.get('title', '')}\n\n{issue.get('body', '')}"

        if source_pr is None:
            source_pr = _find_source_pr(repo_name, issue_number, issue_title, issue_text)
            if source_pr is None:
                return _fix_result(
                    "no_source_pr",
                    "no similar resolved issue with a linked merged pull request was found.",
                )

        plan = plan_fix(repo_name, source_pr, issue_text)
        if not plan["applicable"]:
            return _fix_result(
                "not_applicable", plan["reason"], source_pr=source_pr,
                file=plan.get("file"), changed_lines=plan.get("changed_lines") or 0,
            )

        return open_fix_pr(repo_name, issue_number, plan, issue_title)
    except Exception as exc:
        return _fix_result("error", f"auto-fix failed unexpectedly: {exc}", source_pr=source_pr)
