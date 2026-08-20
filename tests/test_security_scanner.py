"""Regression tests for Layer 1 keyword matching.

Layer 2 (LLM confirmation) is not tested here -- it needs a live Groq key.
These cover the deterministic half, which must never regress.

No network, no API keys.
"""

from agents.triage.security_scanner import SECURITY_KEYWORDS, security_scanner_node


def scan(title, body=""):
    """Layer 1 keywords only, bypassing the LLM confirmation pass."""
    text = f"{title} {body}"
    import re
    from agents.triage.security_scanner import _PATTERN, _canonical
    seen = []
    for m in _PATTERN.finditer(text):
        kw = _canonical(m.group(0))
        if kw not in seen:
            seen.append(kw)
    return seen


def test_keyword_list_matches_contract():
    """agents/CLAUDE.md 4.3 specifies this list exactly."""
    assert SECURITY_KEYWORDS == [
        "xss", "sql injection", "csrf", "ssrf", "rce", "bypass",
        "vulnerability", "exploit", "auth", "authentication", "authorization",
        "overflow", "traversal", "secret", "token", "api key", "password",
        "credential",
    ]


def test_longest_match_wins():
    """'authentication' must not also report the 'auth' inside it."""
    assert scan("authentication is broken") == ["authentication"]


def test_word_boundaries_prevent_substring_hits():
    assert scan("I authored this patch") == []
    assert scan("the tokenizer calls tokenize") == []


def test_underscore_and_hyphen_separators():
    """API_KEY is how a leaked credential actually appears in a traceback.

    A literal-space pattern misses it -- underscore is a word character.
    """
    assert scan("API_KEY leaked") == ["api key"]
    assert scan("api-key exposed") == ["api key"]
    assert scan("sql_injection found") == ["sql injection"]


def test_variants_dedupe_to_one_canonical_finding():
    assert scan("API_KEY and api-key and api key") == ["api key"]


def test_repeated_keyword_yields_one_finding():
    assert scan("xss xss xss xss") == ["xss"]


def test_missing_body_does_not_crash():
    state = {"chain": [], "issue_metadata": {"title": "secret leak", "body": None}}
    assert security_scanner_node(state)["chain"][0]["status"] == "done"


def test_empty_metadata_finds_nothing():
    state = {"chain": [], "issue_metadata": {}}
    assert security_scanner_node(state)["security_findings"] == []
