"""Regression tests for Auto-Fix PRs.

`apply_hunks` is the load-bearing function here -- it is both the
applicability check and the application, and every failure mode it can
produce (divergence, an already-applied fix, an ambiguous location) is a
silent-wrong-answer risk if it is ever loosened, so each is covered on its
own. `select_target_file` calls `fix_snippet.score_hunks`, which loads a
local embedding model; every test here monkeypatches
`agents.triage.fix_snippet.score_hunks` with a fixed-score stand-in so the
suite stays offline and fast, matching how `tests/test_fix_snippet.py`
avoids the network and the model for the functions it can test in isolation.

Not tested here, for the same reason `test_fix_snippet.py` skips
`find_fix_pr`/`extract_fix_snippet`: `plan_fix`, `open_fix_pr`,
`auto_fix_issue`, and `_find_source_pr` all exist to make GitHub API calls,
and mocking PyGithub to prove a mock was called would test the mock, not
this module.

No network, no GitHub token, no model download.
"""

import pytest

from agents.triage import auto_fix, fix_snippet


def make_patch(lines: list[str]) -> str:
    """Join literal hunk lines into unified-diff text, so tests build `Hunk`
    objects via `fix_snippet.split_hunks` -- the real parser -- rather than
    constructing them by hand."""
    return "\n".join(lines) + "\n"


def hunks_from(lines: list[str], file_path: str = "src/app.py") -> list:
    return fix_snippet.split_hunks(make_patch(lines), file_path)


# --- apply_hunks: the clean case --------------------------------------------


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


def test_a_clean_single_hunk_apply_produces_exactly_the_expected_content():
    hunks = hunks_from(GREET_PATCH_LINES, "src/greet.py")
    new_content, reason = auto_fix.apply_hunks(GREET_CONTENT, hunks)
    assert reason is None
    assert new_content == (
        'def greet(name):\n'
        '    if name is None:\n'
        '        name = "there"\n'
        '    return "Hello " + name\n'
        '\n'
        'def farewell(name):\n'
        '    return "Bye " + name\n'
    )


def test_context_divergence_is_rejected_and_the_reason_says_so():
    diverged = GREET_CONTENT.replace('return "Hello " + name', 'return "Hi " + name')
    hunks = hunks_from(GREET_PATCH_LINES, "src/greet.py")
    new_content, reason = auto_fix.apply_hunks(diverged, hunks)
    assert new_content is None
    assert "changed since" in reason
    assert "src/greet.py" in reason


def test_an_already_applied_patch_is_rejected_as_already_applied_not_divergence():
    hunks = hunks_from(GREET_PATCH_LINES, "src/greet.py")
    already_applied, _ = auto_fix.apply_hunks(GREET_CONTENT, hunks)
    new_content, reason = auto_fix.apply_hunks(already_applied, hunks)
    assert new_content is None
    assert reason == "the fix is already applied"


def test_an_ambiguous_two_identical_locations_is_rejected():
    hunks = hunks_from(["@@ -1,2 +1,2 @@", " x", "-y", "+z"], "src/dup.py")
    content = "x\ny\nfoo\nx\ny\n"
    new_content, reason = auto_fix.apply_hunks(content, hunks)
    assert new_content is None
    assert "ambiguous" in reason
    assert "2" in reason


def test_crlf_content_keeps_its_crlf_line_endings():
    hunks = hunks_from(["@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"], "src/crlf.py")
    content = "a\r\nb\r\nc\r\n"
    new_content, reason = auto_fix.apply_hunks(content, hunks)
    assert reason is None
    assert new_content == "a\r\nB\r\nc\r\n"


def test_a_file_with_no_trailing_newline_keeps_none():
    hunks = hunks_from(["@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"], "src/nonewline.py")
    content = "a\nb\nc"
    new_content, reason = auto_fix.apply_hunks(content, hunks)
    assert reason is None
    assert new_content == "a\nB\nc"
    assert not new_content.endswith("\n")


def test_multi_hunk_apply_in_one_file():
    hunks = hunks_from(
        [
            "@@ -1,3 +1,3 @@",
            " one",
            "-two",
            "+TWO",
            " three",
            "@@ -3,3 +3,3 @@",
            " three",
            "-four",
            "+FOUR",
            " five",
        ],
        "src/multi.py",
    )
    content = "one\ntwo\nthree\nfour\nfive\n"
    new_content, reason = auto_fix.apply_hunks(content, hunks)
    assert reason is None
    assert new_content == "one\nTWO\nthree\nFOUR\nfive\n"


def test_an_empty_old_block_is_rejected_for_having_nothing_to_anchor_against():
    # A hunk that is pure addition (no context, no removal) has an empty old
    # block -- there is nothing in it to find in the target file at all.
    hunk = fix_snippet.Hunk("src/new.py", 1, 1, "", ["@@ -0,0 +1,1 @@", "+brand new line"])
    new_content, reason = auto_fix.apply_hunks("anything\n", [hunk])
    assert new_content is None
    assert "no context" in reason


def test_an_unrecognised_marker_rejects_the_whole_patch():
    hunk = fix_snippet.Hunk("src/weird.py", 1, 1, "", ["@@ -1,1 +1,1 @@", "!oops"])
    new_content, reason = auto_fix.apply_hunks("oops\n", [hunk])
    assert new_content is None
    assert "doesn't understand" in reason


# --- count_code_lines --------------------------------------------------------


def test_count_code_lines_ignores_blank_and_comment_only_lines():
    lines = [
        "@@ -1,4 +1,6 @@",
        " context",
        "+    x = 1",
        "+    # just a comment",
        "+",
        "-    y = 2",
        "-    // old comment",
        '+    """',
        "+    docstring",
        '+    """',
    ]
    # code lines: "x = 1", "y = 2", "docstring" -- three real changes.
    assert auto_fix.count_code_lines(lines) == 3


def test_count_code_lines_ignores_context_and_file_header_lines():
    lines = ["--- a/f.py", "+++ b/f.py", "@@ -1,1 +1,1 @@", " unchanged", "-old()", "+new()"]
    assert auto_fix.count_code_lines(lines) == 2


# --- select_target_file ------------------------------------------------------


def _fixed_score(score: float):
    def fake_score_hunks(hunks, issue_text):
        return [(hunk, score) for hunk in hunks]
    return fake_score_hunks


def test_select_target_file_rejects_a_genuinely_multi_file_fix(monkeypatch):
    patch_a = make_patch(["@@ -1,1 +1,2 @@", "-a", "+A", "+A2"])
    patch_b = make_patch(["@@ -1,1 +1,2 @@", "-b", "+B", "+B2"])
    files = [
        {"name": "src/a.py", "differences": patch_a},
        {"name": "src/b.py", "differences": patch_b},
    ]
    monkeypatch.setattr(fix_snippet, "score_hunks", _fixed_score(0.9))

    result = auto_fix.select_target_file(files, "fix a and b")
    assert result["file"] is None
    assert "2 files" in result["reason"]


def test_select_target_file_accepts_a_source_plus_test_fix(monkeypatch):
    patch_src = make_patch(["@@ -1,1 +1,2 @@", "-a", "+A"])
    patch_test = make_patch(["@@ -1,1 +1,2 @@", "-assert a == 1", "+assert a == 2"])
    files = [
        {"name": "src/a.py", "differences": patch_src},
        {"name": "tests/test_a.py", "differences": patch_test},
    ]
    monkeypatch.setattr(fix_snippet, "score_hunks", _fixed_score(0.9))

    result = auto_fix.select_target_file(files, "fix a")
    assert result["file"] == "src/a.py"
    assert result["reason"] is None


def test_select_target_file_rejects_a_fix_whose_only_relevant_part_is_a_test(monkeypatch):
    """A test-only change repairs nothing, and opening a PR for one would
    present an edited assertion as a fix -- the exact confident-but-wrong
    output this module exists to refuse."""
    patch_test = make_patch(["@@ -1,1 +1,1 @@", "-assert a == 1", "+assert a == 2"])
    files = [{"name": "tests/test_a.py", "differences": patch_test}]
    monkeypatch.setattr(fix_snippet, "score_hunks", _fixed_score(0.9))

    result = auto_fix.select_target_file(files, "fix a")
    assert result["file"] is None
    assert "test file" in result["reason"]


@pytest.mark.parametrize(
    "path, is_test",
    [
        ("tests/test_a.py", True),
        ("spec/models_spec.rb", True),
        ("web/App.test.tsx", True),
        ("foo/bar_test.go", True),
        ("__tests__/x.js", True),
        # The dangerous direction: a substring search would call each of these
        # a test, discounting it from the file count and letting a genuinely
        # multi-file fix past the single-file guardrail.
        ("src/latest.py", False),
        ("src/contest.py", False),
        ("app/attestation.py", False),
        ("src/testing_utils.py", False),
        ("src/app.py", False),
    ],
)
def test_is_test_path_matches_conventions_not_substrings(path, is_test):
    assert auto_fix._is_test_path(path) is is_test


def test_select_target_file_does_not_discount_a_source_file_named_like_a_test(monkeypatch):
    """`src/latest.py` is source. Two source files is a multi-file fix."""
    patch = make_patch(["@@ -1,1 +1,1 @@", "-a", "+A"])
    files = [
        {"name": "src/latest.py", "differences": patch},
        {"name": "src/app.py", "differences": patch},
    ]
    monkeypatch.setattr(fix_snippet, "score_hunks", _fixed_score(0.9))

    result = auto_fix.select_target_file(files, "fix it")
    assert result["file"] is None
    assert "2 files" in result["reason"]


def test_select_target_file_rejects_over_20_line_patches(monkeypatch):
    lines = ["@@ -1,1 +1,22 @@", "-old"] + [f"+line {i}" for i in range(21)]
    files = [{"name": "src/big.py", "differences": make_patch(lines)}]
    monkeypatch.setattr(fix_snippet, "score_hunks", _fixed_score(0.9))

    result = auto_fix.select_target_file(files, "fix big")
    assert result["file"] == "src/big.py"
    assert result["reason"] is not None
    assert "20" in result["reason"]
    assert result["changed_lines"] == 22


def test_select_target_file_rejects_when_nothing_clears_the_relevance_floor(monkeypatch):
    files = [{"name": "src/a.py", "differences": make_patch(["@@ -1,1 +1,1 @@", "-a", "+A"])}]
    monkeypatch.setattr(fix_snippet, "score_hunks", _fixed_score(fix_snippet.HUNK_RELEVANCE_THRESHOLD - 0.01))

    result = auto_fix.select_target_file(files, "unrelated")
    assert result["file"] is None
    assert "relevance" in result["reason"]


def test_select_target_file_reports_no_readable_diff():
    files = [{"name": "logo.png", "differences": None}]
    result = auto_fix.select_target_file(files, "anything")
    assert result["file"] is None
    assert "no readable diff" in result["reason"]


# --- enablement gates ---------------------------------------------------------


def test_auto_fix_enabled_is_false_by_default(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("DOOMBOT_AUTO_FIX", raising=False)
    assert auto_fix.auto_fix_enabled() is False


def test_auto_fix_enabled_is_false_under_demo_mode_even_if_opted_in(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    monkeypatch.setenv("DOOMBOT_AUTO_FIX", "1")
    assert auto_fix.auto_fix_enabled() is False


def test_auto_fix_enabled_is_true_only_with_the_opt_in_set(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.setenv("DOOMBOT_AUTO_FIX", "1")
    assert auto_fix.auto_fix_enabled() is True


def test_writes_allowed_is_false_only_under_demo_mode(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    assert auto_fix.writes_allowed() is True
    monkeypatch.setenv("DEMO_MODE", "1")
    assert auto_fix.writes_allowed() is False
