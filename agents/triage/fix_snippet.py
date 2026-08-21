"""Suggested code snippets: show the fix, do not just cite it.

An enhancement to the resolver (F16). When a resolution is grounded in a
previously closed issue, this finds the pull request that actually fixed it,
picks the hunks of that diff which relate to the *new* issue, and returns them
as markdown ready to append to the reply.

The point is the difference between two sentences. "See PR #145 for the fix"
asks the reader to open a PR, find the file, read a diff, and work out which
part applies. A five-line diff block in the reply asks them to read five lines.

**One thing the spec assumed already existed does not.** It describes step one --
"the agent searches ChromaDB for closed issues with high similarity, finds one
with a linked merged PR, and retrieves the PR number. No new work here." The
first half is `resolver._find_resolved_match`. The second half was never built:
`_resolution_context` reads the old issue's *closing comment*, and nothing in
the project has ever looked for a pull request. `find_fix_pr` below is that
missing step, and it is the part most likely to return nothing -- plenty of
issues are closed with an explanation and no linked PR at all.

Every threshold here is from the spec. They are deliberately conservative: the
failure this guards against is not "no snippet", it is a confidently-formatted
diff that has nothing to do with the reader's problem, posted publicly under the
project's name.
"""

from __future__ import annotations

import logging
import math
import re

logger = logging.getLogger(__name__)

# A hunk must be at least this similar to the new issue to be shown. Below it,
# fall back to citing the PR -- the spec's "link-only response".
HUNK_RELEVANCE_THRESHOLD = 0.60

# Never render more than this many lines of diff into a comment. A 200-line
# diff in an issue thread is noise wearing the costume of help.
MAX_SNIPPET_LINES = 50

# A PR this small is shown whole: picking "the relevant hunk" out of 20 lines
# discards context that costs nothing to keep.
SMALL_PR_CHANGED_LINES = 30

MAX_HUNKS = 3

# How many `#123` candidates to check before giving up. Each is one API call,
# and an issue body that cites twenty issues is not pointing at its fix.
MAX_PR_CANDIDATES = 6

_HUNK_HEADER = re.compile(
    r"^@@ -(?P<old>\d+)(?:,(?P<old_count>\d+))? \+(?P<new>\d+)(?:,(?P<new_count>\d+))? @@(?P<section>.*)$"
)
_ISSUE_REF = re.compile(r"#(\d{1,7})\b")
_FENCE_LANG = re.compile(r"```([a-zA-Z0-9+#]+)")
_EXTENSION_IN_TEXT = re.compile(r"[\w/\\.-]+\.([a-zA-Z0-9]{1,4})\b")

# Extension to language. Only languages this project can actually encounter --
# a longer table would imply a confidence in the language check it has not
# earned.
_LANGUAGES: dict[str, str] = {
    "py": "python", "pyi": "python",
    "js": "javascript", "mjs": "javascript", "cjs": "javascript", "jsx": "javascript",
    "ts": "typescript", "tsx": "typescript",
    "rb": "ruby", "go": "go", "rs": "rust", "java": "java", "kt": "kotlin",
    "c": "c", "h": "c", "cpp": "cpp", "cc": "cpp", "hpp": "cpp",
    "cs": "csharp", "php": "php", "swift": "swift", "scala": "scala",
    "css": "css", "scss": "css", "html": "html",
    "json": "json", "yml": "yaml", "yaml": "yaml", "toml": "toml",
    "sh": "shell", "bash": "shell", "md": "markdown", "sql": "sql",
}

# Aliases a human writes in a fence or a sentence.
_LANGUAGE_ALIASES = {
    "python": "python", "py": "python", "python3": "python",
    "js": "javascript", "javascript": "javascript", "node": "javascript",
    "nodejs": "javascript", "jsx": "javascript",
    "ts": "typescript", "typescript": "typescript", "tsx": "typescript",
    "rb": "ruby", "ruby": "ruby", "golang": "go", "go": "go",
    "rust": "rust", "rs": "rust", "java": "java", "kotlin": "kotlin",
    "c": "c", "cpp": "cpp", "c++": "cpp", "csharp": "csharp", "cs": "csharp",
    "php": "php", "swift": "swift", "scala": "scala", "sh": "shell",
    "bash": "shell", "shell": "shell", "sql": "sql",
}

# Tracebacks name their language more reliably than prose does.
_RUNTIME_MARKERS = [
    ("Traceback (most recent call last)", "python"),
    ("ModuleNotFoundError", "python"),
    ("TypeError: Cannot read propert", "javascript"),
    ("at Object.<anonymous>", "javascript"),
    ("Unhandled promise rejection", "javascript"),
    ("panic: runtime error", "go"),
    ("java.lang.", "java"),
]


class Hunk:
    """One `@@` block of a unified diff, with where it came from."""

    __slots__ = ("file_path", "old_start", "new_start", "section", "lines", "changed")

    def __init__(self, file_path, old_start, new_start, section, lines):
        self.file_path = file_path
        self.old_start = old_start
        self.new_start = new_start
        self.section = section.strip()
        self.lines = lines
        self.changed = sum(
            1 for line in lines if line[:1] in ("+", "-") and not line.startswith(("+++", "---"))
        )

    @property
    def line_range(self) -> str:
        span = sum(1 for line in self.lines if not line.startswith("-"))
        end = self.new_start + max(0, span - 1)
        return f"{self.new_start}" if span <= 1 else f"{self.new_start}-{end}"

    @property
    def language(self) -> str | None:
        return language_of(self.file_path)

    def text_for_embedding(self) -> str:
        """What the hunk *means*, for comparison against an issue.

        Only the changed lines, with their markers stripped, plus the section
        header. Context lines are dropped deliberately: they are shared with
        every neighbouring hunk, so including them makes all hunks in a file
        look alike and flattens exactly the ranking this exists to produce.
        """
        changed = [
            line[1:].strip()
            for line in self.lines
            if line[:1] in ("+", "-") and not line.startswith(("+++", "---"))
        ]
        parts = [self.file_path]
        if self.section:
            parts.append(self.section)
        parts.extend(changed)
        return "\n".join(part for part in parts if part)

    def render(self) -> str:
        return "\n".join(self.lines)


def language_of(file_path: str) -> str | None:
    extension = file_path.rsplit(".", 1)[-1].lower() if "." in file_path else ""
    return _LANGUAGES.get(extension)


def issue_languages(text: str) -> set[str]:
    """Languages the issue itself points at.

    Three signals, strongest first: a runtime marker in a traceback, a fenced
    code block's language tag, and file extensions named in the prose. An empty
    result means the issue does not say -- which must not be read as "no
    language matches", or the check would reject every hunk on a prose-only
    report.
    """
    found: set[str] = set()
    if not text:
        return found

    for marker, language in _RUNTIME_MARKERS:
        if marker in text:
            found.add(language)

    for tag in _FENCE_LANG.findall(text):
        alias = _LANGUAGE_ALIASES.get(tag.lower())
        if alias:
            found.add(alias)

    for extension in _EXTENSION_IN_TEXT.findall(text):
        language = _LANGUAGES.get(extension.lower())
        if language:
            found.add(language)

    return found


def split_hunks(patch: str | None, file_path: str) -> list[Hunk]:
    """Split one file's unified diff into hunks.

    Returns [] for a patch GitHub omits, which it does for binary files and for
    files past its per-PR diff limit. That is a normal result, not an error.
    """
    if not patch:
        return []

    hunks: list[Hunk] = []
    header: re.Match[str] | None = None
    body: list[str] = []

    def flush() -> None:
        if header is not None and body:
            hunks.append(
                Hunk(
                    file_path,
                    int(header.group("old")),
                    int(header.group("new")),
                    header.group("section") or "",
                    list(body),
                )
            )

    for line in patch.splitlines():
        match = _HUNK_HEADER.match(line)
        if match:
            flush()
            header = match
            body = [line]
            continue
        if header is not None:
            body.append(line)
    flush()
    return hunks


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def score_hunks(hunks: list[Hunk], issue_text: str) -> list[tuple[Hunk, float]]:
    """Rank hunks by how much they relate to the issue.

    Embedding similarity, plus a boost when the issue names the hunk's file. The
    boost is capped at 1.0 rather than added freely: a filename match is strong
    evidence, but it is not evidence that this *hunk* of that file is the fix.

    Returns unscored pairs (relevance 0.0) if the model is unavailable, so the
    caller's threshold rejects everything rather than the investigation failing.
    """
    if not hunks:
        return []

    try:
        from rag.embedder import _get_model

        model = _get_model()
        issue_vector = model.embed_query(issue_text)
        hunk_vectors = model.embed_documents([hunk.text_for_embedding() for hunk in hunks])
    except Exception:
        logger.warning("hunk scoring unavailable; no snippet will be shown", exc_info=True)
        return [(hunk, 0.0) for hunk in hunks]

    mentioned = _mentioned_paths(issue_text)
    scored: list[tuple[Hunk, float]] = []
    for hunk, vector in zip(hunks, hunk_vectors):
        relevance = _cosine(issue_vector, vector)
        if _file_is_mentioned(hunk.file_path, mentioned):
            relevance = min(1.0, relevance + 0.15)
        scored.append((hunk, relevance))

    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored


def _mentioned_paths(issue_text: str) -> set[str]:
    return {
        token.lower()
        for token in re.findall(r"[\w./\\-]+\.[a-zA-Z0-9]{1,4}\b", issue_text or "")
    }


def _file_is_mentioned(file_path: str, mentioned: set[str]) -> bool:
    if not mentioned:
        return False
    lowered = file_path.lower()
    basename = lowered.rsplit("/", 1)[-1]
    return any(token == basename or token.endswith(lowered) or lowered.endswith(token) for token in mentioned)


def find_fix_pr(repo_name: str, candidates_text: str) -> int | None:
    """The merged pull request that fixed the old issue, if one is findable.

    The step the spec assumed existed. There is no field on an issue that names
    its fix, so this reads the `#123` references out of the closing comment and
    the issue body and asks GitHub which of them is a merged PR. First match
    wins, in the order written -- a closing comment's "fixed by #145" is almost
    always the last reference added and the right one.

    Returns None freely. An issue closed with an explanation and no linked PR is
    the common case, and the caller must degrade to citing the issue.
    """
    from mcp_server.github_client import git_initialization

    seen: list[int] = []
    for match in _ISSUE_REF.finditer(candidates_text or ""):
        number = int(match.group(1))
        if number not in seen:
            seen.append(number)
    if not seen:
        return None

    for number in seen[:MAX_PR_CANDIDATES]:
        try:
            pull = git_initialization(repo_name, number)
        except Exception:
            # Not a pull request, or not readable. Both mean "not the fix".
            continue
        if getattr(pull, "merged", False):
            return number
    return None


def select_hunks(
    scored: list[tuple[Hunk, float]],
    issue_text: str,
    total_changed: int,
) -> tuple[list[Hunk], float, str | None]:
    """Apply the spec's four safeguards.

    Returns (hunks, top_relevance, rejection_reason). A rejection reason is
    returned rather than an empty list alone so the investigation chain can
    record *why* no snippet was shown -- "below the relevance floor" and "the
    PR was too large" are different facts about the same absence.
    """
    if not scored:
        return [], 0.0, "the pull request had no readable diff"

    top = scored[0][1]
    languages = issue_languages(issue_text)

    # Safeguard 4, language. Applied before relevance so a Python fix on a
    # JavaScript issue is rejected as a mismatch rather than reported as
    # irrelevant -- a high embedding score between two languages is exactly the
    # case this guards.
    if languages:
        eligible = [
            (hunk, score)
            for hunk, score in scored
            if hunk.language is None or hunk.language in languages
        ]
        if not eligible:
            wanted = ", ".join(sorted(languages))
            return [], top, f"the fix is not in {wanted}"
        scored = eligible
        top = scored[0][1]

    # Safeguard 1 is the caller's (the 0.75 issue-match bar). Safeguard 2:
    if top < HUNK_RELEVANCE_THRESHOLD:
        return [], top, (
            f"no part of the diff cleared {HUNK_RELEVANCE_THRESHOLD:.2f} relevance"
        )

    # A small PR goes in whole -- see SMALL_PR_CHANGED_LINES.
    if 0 < total_changed <= SMALL_PR_CHANGED_LINES:
        chosen = [hunk for hunk, _ in scored]
    else:
        chosen = [hunk for hunk, score in scored[:MAX_HUNKS] if score >= HUNK_RELEVANCE_THRESHOLD]

    # Safeguard 3, size. Trim whole hunks rather than truncating one: half a
    # diff is worse than one fewer diff, because it looks complete.
    kept: list[Hunk] = []
    budget = MAX_SNIPPET_LINES
    for hunk in chosen:
        cost = len(hunk.lines)
        if cost > budget:
            break
        kept.append(hunk)
        budget -= cost

    if not kept:
        return [], top, "the smallest relevant change was still over 50 lines"
    return kept, top, None


def format_snippet(hunks: list[Hunk], pr_number: int) -> str:
    """Render the chosen hunks as GitHub-flavoured markdown."""
    blocks = [f"Here's the fix from #{pr_number}:", ""]
    for hunk in hunks:
        blocks.append(f"**`{hunk.file_path}`** (lines {hunk.line_range})")
        blocks.append("```diff")
        # The `@@` header is dropped: it is diff plumbing, and the file and
        # line range above already say what it says, in words.
        blocks.extend(line for line in hunk.lines if not line.startswith("@@"))
        blocks.append("```")
        blocks.append("")
    return "\n".join(blocks).rstrip()


def extract_fix_snippet(
    repo_name: str,
    issue_text: str,
    resolution_text: str,
    old_issue_body: str = "",
) -> dict | None:
    """Find the fix PR and return the part of its diff that fits this issue.

    Returns None when there is nothing trustworthy to show -- no linked PR, no
    readable diff, nothing above the relevance floor, a language mismatch, or a
    diff too large to inline. The caller keeps its link-only reply in every one
    of those cases.

    A returned dict carries `markdown` for the reply plus the numbers the
    investigation chain records, so the reader can see the relevance that
    justified showing code at all.
    """
    from mcp_server.github_client import get_pr_files

    # The closing comment first: "fixed by #145" is the strongest signal, and
    # ordering it ahead of the body makes it win the first-match rule.
    pr_number = find_fix_pr(repo_name, f"{resolution_text}\n{old_issue_body}")
    if pr_number is None:
        return None

    try:
        files = get_pr_files(repo_name, pr_number)
    except Exception:
        logger.warning("could not read the diff of #%s", pr_number, exc_info=True)
        return None

    hunks: list[Hunk] = []
    for entry in files or []:
        hunks.extend(split_hunks(entry.get("differences"), entry.get("name") or "?"))
    if not hunks:
        return None

    total_changed = sum(hunk.changed for hunk in hunks)
    scored = score_hunks(hunks, issue_text)
    chosen, top, rejection = select_hunks(scored, issue_text, total_changed)

    if rejection or not chosen:
        return {
            "pr_number": pr_number,
            "markdown": None,
            "top_relevance": round(top, 3),
            "rejected": rejection or "no hunk selected",
            "hunks": [],
        }

    by_hunk = {id(hunk): score for hunk, score in scored}
    return {
        "pr_number": pr_number,
        "markdown": format_snippet(chosen, pr_number),
        "top_relevance": round(top, 3),
        "rejected": None,
        "hunks": [
            {
                "file": hunk.file_path,
                "lines": hunk.line_range,
                "changed": hunk.changed,
                "relevance": round(by_hunk.get(id(hunk), 0.0), 3),
            }
            for hunk in chosen
        ],
    }
