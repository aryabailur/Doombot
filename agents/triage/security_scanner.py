"""Two-layer security detection.

Node: security_scanner
Reads:  issue_metadata
Writes: security_findings

Layer 1 (MUST-HAVE): deterministic keyword match per agents/CLAUDE.md §4.3,
plus a few real-world additions (cve, dos/denial of service, sanitiz) that
show up in genuine vulnerability reports but weren't in the original list.
Layer 2 (CUT unless ahead of schedule): LLM confirmation that the term is
a genuine concern rather than an incidental mention.
"""
import re

from agents.chain import chain_step

SECURITY_KEYWORDS = [
    "xss",
    "sql injection",
    "csrf",
    "ssrf",
    "rce",
    "bypass",
    "vulnerability",
    "exploit",
    "auth",
    "authentication",
    "authenticate",
    "authorization",
    "unauthorized",
    "overflow",
    "traversal",
    "secret",
    "token",
    "api key",
    "password",
    "credential",
    "cve",
    "denial of service",
    "dos",
    "sanitiz",
    "fails open",
]

# How many characters of surrounding context to keep on either side of a
# keyword match, so a finding's "context" reads like a quoted snippet
# rather than the bare keyword.
_CONTEXT_RADIUS = 40


@chain_step(name="security_scanner", title="Scanning for security-sensitive content")
def security_scanner(state):
    issue_metadata = state.get("issue_metadata", {}) or {}

    title = issue_metadata.get("title", "") or ""
    body = issue_metadata.get("body", "") or ""
    text = f"{title} {body}"
    # Normalize underscores/hyphens to spaces so "API_KEY" / "api-key" both
    # match the "api key" keyword the same way a plain-space form would.
    lowered = re.sub(r"[_-]", " ", text.lower())

    findings = []
    evidence = []
    for keyword in SECURITY_KEYWORDS:
        # \b word-boundary match — a bare substring search would let short
        # keywords like "rce" or "dos" match inside unrelated words (e.g.
        # "rce" inside "enforcement"), producing a false-positive finding.
        match = re.search(r"\b" + re.escape(keyword) + r"\b", lowered)
        if match is None:
            continue
        idx = match.start()

        start = max(0, idx - _CONTEXT_RADIUS)
        end = min(len(text), idx + len(keyword) + _CONTEXT_RADIUS)
        context = text[start:end].strip() or keyword

        findings.append({"keyword": keyword, "context": context})
        evidence.append(
            {
                "type": "security",
                "ref": keyword,
                "score": 1.0,
                "snippet": context,
            }
        )

    patch = {"security_findings": findings}
    return patch, evidence
