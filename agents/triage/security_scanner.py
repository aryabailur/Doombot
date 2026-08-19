"""Two-layer security detection.

Node: security_scanner
Reads:  issue_metadata
Writes: security_findings

Layer 1: deterministic, case-insensitive keyword match over
`issue_metadata["title"] + " " + issue_metadata["body"]`.

Layer 2: an LLM pass that narrows Layer 1's hits to the ones describing a
genuine concern. Originally scoped as optional, but a live run made it
necessary: a plain bug report saying "authentication stopped working after
an upgrade" was escalated as a security issue, because keyword matching
cannot distinguish a broken feature from a vulnerability. Escalating every
bug that says "auth" is precisely the noise selective escalation exists to
prevent.

Layer 2 only narrows, never adds, and passes findings through unchanged if
the LLM is unavailable -- an outage must not silently disable security
detection.
"""

import json
import os
import re

from agents.chain import chain_step
from agents.state import GraphState

# Exact list from agents/CLAUDE.md §4.3. Order doesn't matter for matching
# (see _build_pattern, which sorts by length internally) but is kept as
# specified for readability / diffing against the contract.
SECURITY_KEYWORDS = [
    "xss", "sql injection", "csrf", "ssrf", "rce", "bypass", "vulnerability",
    "exploit", "auth", "authentication", "authorization", "overflow",
    "traversal", "secret", "token", "api key", "password", "credential",
]

# Fast lookup for _canonical(). Set, not list, because it is hit once per match.
_CANONICAL = set(SECURITY_KEYWORDS)

# ~80 chars of surrounding text, split roughly evenly before/after the hit.
_CONTEXT_RADIUS = 40


def _build_pattern() -> re.Pattern:
    """Compile one alternation pattern for all keywords, longest-first.

    Longest-first ordering matters because regex alternation is
    first-match-wins at a given position: without it, "auth" would win over
    "authentication" and "authorization" whenever they overlap, producing a
    spurious extra finding for the same span. Sorting the alternatives by
    descending length makes the engine try "authentication" and
    "authorization" before the bare "auth" branch, so a longer match at a
    position always shadows the shorter one contained in it.

    `\\b...\\b` prevents substring false-positives ("token" won't match
    inside "tokenize", "auth" won't match inside a word like "authored").

    Multi-word keywords accept any run of non-alphanumerics as the separator,
    not just a literal space. Real reports write the same concept as
    "API_KEY", "api-key", "apiKey", or "api key" -- and a leaked credential in
    a traceback is almost always the underscore form. A literal " " would miss
    every one of those, which is precisely the case the demo showcases.
    `[^a-z0-9]+` (case-insensitive) is deliberately loose here: a false
    positive costs a maintainer one glance, a false negative costs a missed
    vulnerability.
    """
    ordered = sorted(SECURITY_KEYWORDS, key=len, reverse=True)
    alternation = "|".join(
        r"[^a-z0-9]+".join(re.escape(word) for word in kw.split())
        for kw in ordered
    )
    return re.compile(rf"\b(?:{alternation})\b", re.IGNORECASE)


def _canonical(matched: str) -> str:
    """Map matched text back to its canonical keyword.

    "API_KEY", "api-key", and "api key" are all the same finding. Reporting
    the raw matched text would defeat dedup (three findings for one concern)
    and hand the dashboard an unstable label. Collapse each match to the
    canonical spelling from SECURITY_KEYWORDS by normalizing separators.
    """
    normalized = re.sub(r"[^a-z0-9]+", " ", matched.lower()).strip()
    return normalized if normalized in _CANONICAL else matched.lower()


_PATTERN = _build_pattern()


def _context(text: str, start: int, end: int) -> str:
    """~80 chars of surrounding text centered on the match span."""
    lo = max(0, start - _CONTEXT_RADIUS)
    hi = min(len(text), end + _CONTEXT_RADIUS)
    snippet = text[lo:hi].strip()
    return snippet


_CONFIRM_PROMPT = """You are triaging a GitHub issue for security relevance.

A keyword scan flagged these terms. For EACH, decide whether the issue
actually describes a security concern (a vulnerability, an exploit, or a
leaked credential) or merely mentions the word while describing an ordinary
bug or feature request.

"authentication stopped working after an upgrade" is a BUG, not a security
concern. "authentication can be bypassed with a crafted header" IS one.
A traceback that prints a real API key IS one.

Issue title: {title}

Issue body:
{body}

Flagged terms: {keywords}

Respond with ONLY a JSON object, no prose, no code fence:
{{"confirmed": ["term", ...], "reason": "one short sentence"}}

confirmed lists only the terms that reflect a genuine security concern. An
empty list is correct and expected for ordinary bugs."""


def _get_llm():
    """Lazily construct the Groq chat model.

    Lazy so importing this module for a keyword-only unit test does not
    require GROQ_API_KEY.
    """
    from langchain_groq import ChatGroq

    return ChatGroq(model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"))


def _confirm(title: str, body: str, findings: list[dict]) -> tuple[list[dict], str]:
    """Layer 2: ask the LLM which keyword hits are genuine security concerns.

    Narrows Layer 1's findings; never adds to them. On any failure the
    findings pass through unchanged -- a Groq outage must not silently
    disable security detection, and over-reporting is the safe direction.
    """
    keywords = [f["keyword"] for f in findings]
    prompt = _CONFIRM_PROMPT.format(
        title=title, body=(body or "(no body)")[:3000], keywords=", ".join(keywords)
    )
    try:
        raw = getattr(_get_llm().invoke(prompt), "content", "") or ""
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return findings, "LLM response unparseable; keeping keyword hits"
        data = json.loads(match.group(0))
        confirmed = {str(k).lower() for k in data.get("confirmed", [])}
        reason = str(data.get("reason", ""))[:200]
    except Exception as exc:
        return findings, f"LLM unavailable ({exc}); keeping keyword hits"

    return [f for f in findings if f["keyword"].lower() in confirmed], reason


@chain_step("security_scanner", "Scanning for security concerns")
def security_scanner_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Layer 1: deterministic keyword scan of the issue title + body.

    Matches SECURITY_KEYWORDS case-insensitively against
    `title + " " + body`, deduplicating so a keyword appearing multiple
    times produces exactly one finding (using the first occurrence's
    context). Overlapping keywords (e.g. "auth" inside "authentication")
    are resolved by the longest-match-wins regex built in _build_pattern --
    a shorter keyword contained entirely within a longer match is not
    reported separately for that span.
    """
    metadata = state.get("issue_metadata") or {}
    title = metadata.get("title") or ""
    body = metadata.get("body") or ""
    text = f"{title} {body}"

    seen: dict[str, str] = {}  # keyword -> first-occurrence context, in match order
    for match in _PATTERN.finditer(text):
        keyword = _canonical(match.group(0))
        if keyword in seen:
            continue
        seen[keyword] = _context(text, match.start(), match.end())

    findings = [{"keyword": kw, "context": ctx} for kw, ctx in seen.items()]
    evidence = [
        {"type": "rule", "ref": kw, "score": None, "snippet": ctx}
        for kw, ctx in seen.items()
    ]

    # Layer 2 only runs when Layer 1 found something -- no hits, no LLM call,
    # so the common case stays free and instant.
    if findings:
        confirmed, reason = _confirm(title, body, findings)
        dropped = [f["keyword"] for f in findings if f not in confirmed]
        evidence.append({
            "type": "rule",
            "ref": "llm_confirmation",
            "score": None,
            "snippet": (
                f"confirmed {[f['keyword'] for f in confirmed] or 'none'}"
                + (f", dismissed {dropped} as incidental" if dropped else "")
                + f" -- {reason}"
            ),
        })
        findings = confirmed

    return {"security_findings": findings}, evidence
