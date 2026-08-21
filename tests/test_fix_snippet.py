"""Regression tests for suggested code snippets.

Everything here is the decision logic, tested without GitHub or the embedding
model. Two functions are deliberately not tested: `find_fix_pr` and
`extract_fix_snippet` both exist to make API calls, and mocking PyGithub to
prove that a mock was called would test the mock.

What is tested is what can be wrong quietly: a hunk parser that drops the last
hunk of a file, a size limit that truncates a diff into something that looks
complete, and a language check that lets a Python fix onto a JavaScript issue.
That last one is the whole risk of the feature -- a confidently formatted diff
with nothing to do with the reader's problem, posted publicly.

No network, no API keys, no embedding model.
"""

import pytest

from agents.triage.fix_snippet import (
    HUNK_RELEVANCE_THRESHOLD,
    MAX_SNIPPET_LINES,
    SMALL_PR_CHANGED_LINES,
    Hunk,
    format_snippet,
    issue_languages,
    language_of,
    select_hunks,
    split_hunks,
)

# A real-shaped patch: two hunks, one of which is the null check the spec's
# worked example uses.
PATCH = """@@ -40,6 +40,9 @@ class AuthMiddleware:
 def validate_token(token):
-    payload = jwt.decode(token, SECRET_KEY)
+    if token is None:
+        raise AuthenticationError("No token provided")
+    payload = jwt.decode(token, SECRET_KEY)
     return payload["user_id"]
@@ -88,3 +91,4 @@ def teardown():
     session.close()
+    cache.clear()
"""


def hunk(file_path="src/auth.py", lines=None, old=40, new=40, section=""):
    return Hunk(file_path, old, new, section, lines or ["@@ -40,1 +40,1 @@", "+x"])


# --- diff parsing -----------------------------------------------------------


def test_both_hunks_are_parsed_including_the_last():
    """The last hunk has no following `@@` to terminate it -- a parser that
    only flushes on the next header silently drops it."""
    hunks = split_hunks(PATCH, "src/auth.py")
    assert len(hunks) == 2
    assert hunks[0].new_start == 40
    assert hunks[1].new_start == 91


def test_the_section_header_is_captured():
    hunks = split_hunks(PATCH, "src/auth.py")
    assert hunks[0].section == "class AuthMiddleware:"


def test_changed_lines_are_counted_not_context_lines():
    hunks = split_hunks(PATCH, "src/auth.py")
    # 1 removal + 3 additions in the first hunk; context is not a change.
    assert hunks[0].changed == 4
    assert hunks[1].changed == 1


def test_a_missing_patch_is_an_empty_result_not_a_crash():
    """GitHub omits `patch` for binary files and past its per-PR diff limit."""
    assert split_hunks(None, "logo.png") == []
    assert split_hunks("", "x.py") == []
    assert split_hunks("no hunk headers here", "x.py") == []


def test_the_embedding_text_drops_context_lines():
    """Context is shared with neighbouring hunks, so including it makes every
    hunk in a file look alike and flattens the ranking."""
    text = split_hunks(PATCH, "src/auth.py")[0].text_for_embedding()
    assert "AuthenticationError" in text          # a changed line
    assert 'return payload["user_id"]' not in text  # a context line
    assert "src/auth.py" in text


def test_the_line_range_describes_the_new_file():
    hunks = split_hunks(PATCH, "src/auth.py")
    assert hunks[0].line_range.startswith("40")
    assert "-" in hunks[0].line_range


# --- language detection -----------------------------------------------------


@pytest.mark.parametrize(
    "path,expected",
    [
        ("src/auth.py", "python"),
        ("src/app.tsx", "typescript"),
        ("index.mjs", "javascript"),
        ("main.go", "go"),
        ("Makefile", None),
        ("noextension", None),
    ],
)
def test_language_of(path, expected):
    assert language_of(path) == expected


def test_a_traceback_names_its_language():
    text = "Traceback (most recent call last):\n  File 'x', line 1"
    assert issue_languages(text) == {"python"}


def test_a_fenced_block_names_its_language():
    assert "javascript" in issue_languages("```js\nconst x = 1\n```")


def test_a_mentioned_filename_names_its_language():
    assert "python" in issue_languages("the crash is in middleware/auth.py")


def test_prose_with_no_signal_names_nothing():
    """Empty must not be read as "nothing matches" -- that would reject every
    hunk on a prose-only report, which is most of them."""
    assert issue_languages("It crashes when I log in.") == set()
    assert issue_languages("") == set()


# --- the four safeguards ----------------------------------------------------


def test_nothing_below_the_relevance_floor_is_shown():
    scored = [(hunk(), HUNK_RELEVANCE_THRESHOLD - 0.01)]
    chosen, top, reason = select_hunks(scored, "unrelated prose", total_changed=100)
    assert chosen == []
    assert "relevance" in reason
    assert top == pytest.approx(HUNK_RELEVANCE_THRESHOLD - 0.01)


def test_at_the_floor_exactly_it_is_shown():
    scored = [(hunk(), HUNK_RELEVANCE_THRESHOLD)]
    chosen, _, reason = select_hunks(scored, "prose", total_changed=100)
    assert len(chosen) == 1
    assert reason is None


def test_a_python_fix_is_refused_on_a_javascript_issue():
    """The safeguard that matters most. A high embedding score across two
    languages is exactly the case a relevance threshold alone lets through."""
    scored = [(hunk(file_path="src/auth.py"), 0.95)]
    chosen, _, reason = select_hunks(
        scored, "TypeError: Cannot read property of undefined in app.js", total_changed=100
    )
    assert chosen == []
    assert "javascript" in reason


def test_a_matching_language_passes():
    scored = [(hunk(file_path="src/auth.py"), 0.9)]
    chosen, _, reason = select_hunks(
        scored, "Traceback (most recent call last): auth.py", total_changed=100
    )
    assert len(chosen) == 1
    assert reason is None


def test_a_language_mismatch_is_reported_as_such_not_as_irrelevance():
    """Two different facts about the same absence, and the chain records which."""
    scored = [(hunk(file_path="a.py"), 0.95)]
    _, _, reason = select_hunks(scored, "```js\nx\n```", total_changed=100)
    assert "not in" in reason
    assert "relevance" not in reason


def test_an_extensionless_file_is_not_rejected_by_the_language_check():
    """`language_of` returns None for a Makefile or a config file; that is
    unknown, not wrong, and must not be treated as a mismatch."""
    scored = [(hunk(file_path="Dockerfile"), 0.9)]
    chosen, _, _ = select_hunks(scored, "Traceback (most recent call last)", total_changed=100)
    assert len(chosen) == 1


def test_a_small_pr_is_shown_whole():
    """Picking "the relevant hunk" out of 20 lines discards free context."""
    scored = [(hunk(lines=["@@ -1 +1 @@", "+a"]), 0.9), (hunk(lines=["@@ -9 +9 @@", "+b"]), 0.61)]
    chosen, _, _ = select_hunks(scored, "prose", total_changed=SMALL_PR_CHANGED_LINES)
    assert len(chosen) == 2


def test_a_large_pr_is_capped_to_three_hunks():
    scored = [(hunk(lines=["@@ -1 +1 @@", "+a"]), 0.9 - i * 0.01) for i in range(6)]
    chosen, _, _ = select_hunks(scored, "prose", total_changed=200)
    assert len(chosen) == 3


def test_the_size_limit_drops_whole_hunks_rather_than_truncating_one():
    """Half a diff is worse than one fewer diff, because it looks complete."""
    big = hunk(lines=["@@ -1 +1 @@"] + [f"+line {i}" for i in range(MAX_SNIPPET_LINES - 1)])
    small = hunk(lines=["@@ -9 +9 @@", "+one"])
    chosen, _, _ = select_hunks([(big, 0.9), (small, 0.8)], "prose", total_changed=200)
    assert chosen == [big]
    assert all(len(h.lines) == len(h.render().splitlines()) for h in chosen)


def test_a_single_oversized_hunk_is_cited_not_inlined():
    huge = hunk(lines=["@@ -1 +1 @@"] + [f"+line {i}" for i in range(MAX_SNIPPET_LINES + 10)])
    chosen, _, reason = select_hunks([(huge, 0.95)], "prose", total_changed=500)
    assert chosen == []
    assert "50 lines" in reason


def test_no_hunks_at_all_reports_why():
    chosen, top, reason = select_hunks([], "prose", total_changed=0)
    assert chosen == []
    assert top == 0.0
    assert "no readable diff" in reason


# --- rendering --------------------------------------------------------------


def test_the_rendered_snippet_is_a_diff_block_with_its_file_and_lines():
    hunks = split_hunks(PATCH, "src/auth.py")[:1]
    out = format_snippet(hunks, 145)
    assert "#145" in out
    assert "**`src/auth.py`**" in out
    assert "```diff" in out
    assert out.count("```") == 2
    assert '+        raise AuthenticationError("No token provided")' in out


def test_the_at_at_header_is_not_rendered():
    """Diff plumbing. The file and line range above already say it, in words."""
    out = format_snippet(split_hunks(PATCH, "src/auth.py"), 145)
    assert "@@" not in out


def test_every_selected_hunk_is_rendered():
    out = format_snippet(split_hunks(PATCH, "src/auth.py"), 145)
    assert out.count("```diff") == 2
