"""Tests for regression watching (agents/triage/regression.py).

The load-bearing discriminator is `auto_fix.apply_hunks`'s three-way result,
completely unmodified: "already applied" is healthy, a clean apply is the
regression, and anything else is "cannot tell". `detect` is exercised end to
end with `candidate_fixes`, `get_default_branch`, and `get_file_at_ref`
monkeypatched, so the real `apply_hunks` still does the discriminating.

`select_single_file` needs no monkeypatching at all -- unlike
`auto_fix.select_target_file`, it never scores a hunk against issue text
(there is no issue here), so there is no embedding model in its path to stub
out.

No network, no GitHub token, no model download.
"""

import pytest

from agents.triage import auto_fix, fix_snippet, regression
from mcp_server import github_client


def make_patch(lines: list[str]) -> str:
    """Join literal hunk lines into unified-diff text, so tests build `Hunk`
    objects via `fix_snippet.split_hunks` -- the real parser."""
    return "\n".join(lines) + "\n"


def hunks_from(lines: list[str], file_path: str = "src/app.py") -> list:
    return fix_snippet.split_hunks(make_patch(lines), file_path)


@pytest.fixture(autouse=True)
def _reset_module_state():
    """`regression` keeps process-lifetime module state (baseline HEAD,
    recorded findings, the candidate cache). Reset it around every test so
    tests cannot leak state into one another."""
    regression._baseline.clear()
    regression._findings.clear()
    regression._candidate_cache.clear()
    yield
    regression._baseline.clear()
    regression._findings.clear()
    regression._candidate_cache.clear()


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Stub `candidate_fixes` for every test in this file.

    `sweep`'s baseline call pre-loads the candidate cache, and that is a real
    GitHub round trip -- a pull request listing plus a diff read per candidate.
    Several tests below call `sweep` twice to get past the baseline and reach
    the branch they care about, so without a blanket stub this suite quietly
    reaches the network: slow, dependent on a token, and testing something none
    of these tests are about. A test that cares about candidates overrides this
    with its own `monkeypatch.setattr`, which wins by running later.
    """
    monkeypatch.setattr(
        regression,
        "candidate_fixes",
        lambda repo_name, limit=regression.MAX_CANDIDATE_PRS: [],
    )


# --- fixtures shared by the detect() tests -----------------------------------

GREET_CONTENT = (
    'def greet(name):\n'
    '    return "Hello " + name\n'
    '\n'
    'def farewell(name):\n'
    '    return "Bye " + name\n'
)

GREET_PATCH_LINES = [
    "@@ -1,4 +1,6 @@",
    " def greet(name):",
    '-    return "Hello " + name',
    "+    if name is None:",
    '+        name = "there"',
    '+    return "Hello " + name',
    " ",
    " def farewell(name):",
]


def _greet_candidate() -> dict:
    hunks = hunks_from(GREET_PATCH_LINES, "src/greet.py")
    return {"pr": 10, "title": "Fix greeting a None name", "file": "src/greet.py",
            "hunks": hunks, "changed_lines": 3}


def _stub_detect_plumbing(monkeypatch, candidate: dict, content: str) -> None:
    monkeypatch.setattr(
        regression, "candidate_fixes",
        lambda repo_name, limit=regression.MAX_CANDIDATE_PRS: [candidate],
    )
    monkeypatch.setattr(github_client, "get_default_branch", lambda repo_name: "main")
    monkeypatch.setattr(
        github_client, "get_file_at_ref",
        lambda repo_name, path, ref=None: {"content": content, "sha": "deadbeef", "path": path},
    )


# --- detect(): the one discriminator that matters ----------------------------


def test_detect_a_fix_still_present_is_not_a_regression(monkeypatch):
    candidate = _greet_candidate()
    fixed_content, reason = auto_fix.apply_hunks(GREET_CONTENT, candidate["hunks"])
    assert reason is None  # sanity: the patch really does apply to the unfixed content

    _stub_detect_plumbing(monkeypatch, candidate, fixed_content)

    assert regression.detect("owner/repo") == []


def test_detect_a_reverted_fix_is_a_regression(monkeypatch):
    candidate = _greet_candidate()
    # GREET_CONTENT is the *pre-fix* content -- the lines the fix added are
    # missing, which is exactly the regressed state.
    _stub_detect_plumbing(monkeypatch, candidate, GREET_CONTENT)

    findings = regression.detect("owner/repo")
    assert len(findings) == 1
    finding = findings[0]
    assert finding["source_pr"] == 10
    assert finding["source_title"] == "Fix greeting a None name"
    assert finding["file"] == "src/greet.py"
    assert finding["changed_lines"] == 3
    assert "#10" in finding["diff"]


def test_detect_a_refactored_file_yields_no_finding(monkeypatch):
    """Neither "already applied" nor "applies cleanly" -- the file moved on
    and there is no way to tell what happened, so nothing is reported."""
    candidate = _greet_candidate()
    refactored = "def totally_different():\n    pass\n"
    _stub_detect_plumbing(monkeypatch, candidate, refactored)

    assert regression.detect("owner/repo") == []


def test_detect_respects_only_files_narrowing(monkeypatch):
    candidate = _greet_candidate()
    _stub_detect_plumbing(monkeypatch, candidate, GREET_CONTENT)

    # The candidate's file isn't in only_files -- a commit that never touched
    # it shouldn't have it re-checked.
    assert regression.detect("owner/repo", only_files={"some/other/file.py"}) == []
    assert regression.detect("owner/repo", only_files={"src/greet.py"}) != []
    assert regression.detect("owner/repo", only_files=None) != []


# --- select_single_file: no relevance scoring, no embedding model ------------


def test_select_single_file_rejects_a_genuinely_multi_file_fix():
    patch_a = make_patch(["@@ -1,1 +1,2 @@", "-a", "+A", "+A2"])
    patch_b = make_patch(["@@ -1,1 +1,2 @@", "-b", "+B", "+B2"])
    files = [
        {"name": "src/a.py", "differences": patch_a},
        {"name": "src/b.py", "differences": patch_b},
    ]

    result = regression.select_single_file(files)
    assert result["file"] is None
    assert "2 files" in result["reason"]


def test_select_single_file_accepts_a_source_plus_test_fix():
    patch_src = make_patch(["@@ -1,1 +1,2 @@", "-a", "+A"])
    patch_test = make_patch(["@@ -1,1 +1,2 @@", "-assert a == 1", "+assert a == 2"])
    files = [
        {"name": "src/a.py", "differences": patch_src},
        {"name": "tests/test_a.py", "differences": patch_test},
    ]

    result = regression.select_single_file(files)
    assert result["file"] == "src/a.py"
    assert result["reason"] is None
    assert result["changed_lines"] == 2  # one removed line, one added line


def test_select_single_file_rejects_a_test_only_fix():
    patch_test = make_patch(["@@ -1,1 +1,1 @@", "-assert a == 1", "+assert a == 2"])
    files = [{"name": "tests/test_a.py", "differences": patch_test}]

    result = regression.select_single_file(files)
    assert result["file"] is None
    assert "test" in result["reason"]


def test_select_single_file_rejects_over_20_line_patches():
    lines = ["@@ -1,1 +1,22 @@", "-old"] + [f"+line {i}" for i in range(21)]
    files = [{"name": "src/big.py", "differences": make_patch(lines)}]

    result = regression.select_single_file(files)
    assert result["file"] == "src/big.py"
    assert result["reason"] is not None
    assert "20" in result["reason"]
    assert result["changed_lines"] == 22


def test_select_single_file_accepts_exactly_20_lines():
    lines = ["@@ -1,1 +1,20 @@", "-old"] + [f"+line {i}" for i in range(19)]
    files = [{"name": "src/exact.py", "differences": make_patch(lines)}]

    result = regression.select_single_file(files)
    assert result["changed_lines"] == 20
    assert result["reason"] is None


def test_select_single_file_reports_no_readable_diff():
    files = [{"name": "logo.png", "differences": None}]

    result = regression.select_single_file(files)
    assert result["file"] is None
    assert "no readable diff" in result["reason"]


# --- watch_enabled(): mirrors auto_fix.auto_fix_enabled ----------------------


def test_watch_enabled_is_false_by_default(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("DOOMBOT_WATCH_REGRESSIONS", raising=False)
    assert regression.watch_enabled() is False


def test_watch_enabled_is_false_under_demo_mode_even_if_opted_in(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    monkeypatch.setenv("DOOMBOT_WATCH_REGRESSIONS", "1")
    assert regression.watch_enabled() is False


def test_watch_enabled_is_true_only_with_the_opt_in_set(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.setenv("DOOMBOT_WATCH_REGRESSIONS", "1")
    assert regression.watch_enabled() is True


# --- already_reported: the anti-spam guard -----------------------------------


class _FakeIssue:
    def __init__(self, number, body, pull_request=None):
        self.number = number
        self.body = body
        self.pull_request = pull_request


class _FakeRepo:
    def __init__(self, issues):
        self._issues = issues

    def get_issues(self, state="open"):
        return self._issues


def test_already_reported_matches_the_marker(monkeypatch):
    marker = regression.MARKER.format(source_pr=42)
    issues = [
        _FakeIssue(1, "an unrelated issue body"),
        _FakeIssue(2, f"some description\n\n{marker}\n"),
    ]
    monkeypatch.setattr(github_client, "_repo", lambda repo_name: _FakeRepo(issues))

    assert regression.already_reported("owner/repo", 42) == 2


def test_already_reported_ignores_unrelated_issue_bodies(monkeypatch):
    other_marker = regression.MARKER.format(source_pr=99)
    issues = [_FakeIssue(1, "nothing to see here"), _FakeIssue(2, other_marker)]
    monkeypatch.setattr(github_client, "_repo", lambda repo_name: _FakeRepo(issues))

    assert regression.already_reported("owner/repo", 42) is None


def test_already_reported_ignores_pull_requests(monkeypatch):
    marker = regression.MARKER.format(source_pr=42)
    issues = [_FakeIssue(3, marker, pull_request=object())]
    monkeypatch.setattr(github_client, "_repo", lambda repo_name: _FakeRepo(issues))

    assert regression.already_reported("owner/repo", 42) is None


# --- sweep(): baseline on first call, detection after --------------------------


def test_sweep_first_call_records_a_baseline_and_returns_nothing(monkeypatch):
    monkeypatch.setattr(regression, "head_sha", lambda repo_name: "sha-A")

    detect_called = []
    monkeypatch.setattr(
        regression, "detect",
        lambda repo_name, only_files=None: detect_called.append(1) or [],
    )
    # The baseline call also pre-loads the candidate cache, which is the one
    # expensive thing this module does. Stubbed so the suite stays offline --
    # without this the test reaches GitHub, which is both slow and a lie about
    # what is being tested.
    warmed = []
    monkeypatch.setattr(
        regression, "candidate_fixes",
        lambda repo_name, limit=regression.MAX_CANDIDATE_PRS: warmed.append(repo_name) or [],
    )

    result = regression.sweep("owner/repo")

    assert result == []
    assert regression._baseline["owner/repo"] == "sha-A"
    assert not detect_called  # no scan on the baseline-recording call
    assert warmed == ["owner/repo"]  # but the cache is warmed for next time


def test_baseline_survives_a_failure_to_pre_load_candidates(monkeypatch):
    """A cold cache is a slow next sweep, not a broken one."""
    monkeypatch.setattr(regression, "head_sha", lambda repo_name: "sha-A")

    def boom(repo_name, limit=regression.MAX_CANDIDATE_PRS):
        raise RuntimeError("GitHub is down")

    monkeypatch.setattr(regression, "candidate_fixes", boom)

    assert regression.sweep("owner/repo") == []
    assert regression._baseline["owner/repo"] == "sha-A"


def test_sweep_returns_nothing_when_head_is_unchanged(monkeypatch):
    monkeypatch.setattr(regression, "head_sha", lambda repo_name: "sha-A")
    regression.sweep("owner/repo")  # baseline

    detect_called = []
    monkeypatch.setattr(
        regression, "detect",
        lambda repo_name, only_files=None: detect_called.append(1) or [],
    )
    result = regression.sweep("owner/repo")

    assert result == []
    assert not detect_called


def test_sweep_reports_blocked_status_when_watching_is_disabled(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("DOOMBOT_WATCH_REGRESSIONS", raising=False)
    monkeypatch.delenv("DOOMBOT_AUTO_FIX", raising=False)

    heads = iter(["sha-A", "sha-B"])
    monkeypatch.setattr(regression, "head_sha", lambda repo_name: next(heads))
    monkeypatch.setattr(regression, "changed_files", lambda repo_name, base, head: {"f.py"})
    monkeypatch.setattr(
        regression, "detect",
        lambda repo_name, only_files=None: [
            {"source_pr": 7, "source_title": "Fix f", "file": "f.py",
             "changed_lines": 4, "diff": "the diff"}
        ],
    )
    monkeypatch.setattr(regression, "already_reported", lambda repo_name, source_pr: None)

    regression.sweep("owner/repo")  # baseline, sha-A
    result = regression.sweep("owner/repo")  # sha-B, detects the finding

    assert len(result) == 1
    finding = result[0]
    assert finding["source_pr"] == 7
    assert finding["status"] == "blocked"
    assert finding["issue_number"] is None
    assert finding["head_sha"] == "sha-B"
    assert regression._baseline["owner/repo"] == "sha-B"


def test_sweep_files_an_issue_when_watching_is_enabled(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.setenv("DOOMBOT_WATCH_REGRESSIONS", "1")
    monkeypatch.delenv("DOOMBOT_AUTO_FIX", raising=False)

    heads = iter(["sha-A", "sha-B"])
    monkeypatch.setattr(regression, "head_sha", lambda repo_name: next(heads))
    monkeypatch.setattr(regression, "changed_files", lambda repo_name, base, head: {"f.py"})
    monkeypatch.setattr(
        regression, "detect",
        lambda repo_name, only_files=None: [
            {"source_pr": 7, "source_title": "Fix f", "file": "f.py",
             "changed_lines": 4, "diff": "the diff"}
        ],
    )
    monkeypatch.setattr(regression, "already_reported", lambda repo_name, source_pr: None)
    monkeypatch.setattr(regression, "file_regression_issue", lambda repo_name, finding: 99)

    regression.sweep("owner/repo")  # baseline
    result = regression.sweep("owner/repo")

    assert len(result) == 1
    assert result[0]["status"] == "issue_filed"
    assert result[0]["issue_number"] == 99
    # auto-fix is off, so no pull request should have been attempted
    assert result[0]["pr_number"] is None


def test_sweep_returns_existing_status_when_already_reported(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("DOOMBOT_WATCH_REGRESSIONS", raising=False)

    heads = iter(["sha-A", "sha-B"])
    monkeypatch.setattr(regression, "head_sha", lambda repo_name: next(heads))
    monkeypatch.setattr(regression, "changed_files", lambda repo_name, base, head: {"f.py"})
    monkeypatch.setattr(
        regression, "detect",
        lambda repo_name, only_files=None: [
            {"source_pr": 7, "source_title": "Fix f", "file": "f.py",
             "changed_lines": 4, "diff": "the diff"}
        ],
    )
    # Already reported, even though watching is otherwise disabled -- an
    # existing report must still be surfaced, not hidden behind "blocked".
    monkeypatch.setattr(regression, "already_reported", lambda repo_name, source_pr: 55)

    regression.sweep("owner/repo")
    result = regression.sweep("owner/repo")

    assert result[0]["status"] == "issue_filed"
    assert result[0]["issue_number"] == 55


def test_sweep_never_raises_on_an_unexpected_failure(monkeypatch):
    def boom(repo_name):
        raise RuntimeError("network is down")

    monkeypatch.setattr(regression, "head_sha", boom)

    assert regression.sweep("owner/repo") == []


# --- recent(): newest first, filterable by repo ------------------------------


def test_recent_returns_newest_first_and_filters_by_repo():
    regression._findings.append(("owner/a", {"source_pr": 1}))
    regression._findings.append(("owner/b", {"source_pr": 2}))
    regression._findings.append(("owner/a", {"source_pr": 3}))

    assert [f["source_pr"] for f in regression.recent()] == [3, 2, 1]
    assert [f["source_pr"] for f in regression.recent("owner/a")] == [3, 1]
    assert [f["source_pr"] for f in regression.recent("owner/b")] == [2]
