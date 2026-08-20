"""F18 — the MCP intelligence layer's surface and its safety invariant.

These tests are offline: no GitHub, no model, no network. They assert the two
things that are cheap to break and expensive to notice — that every tool is
actually registered under the name callers import, and that none of them can
write to GitHub.
"""

from __future__ import annotations

import asyncio
import inspect

import pytest

from mcp_server import intelligence
from mcp_server.tool_names import INTELLIGENCE_TOOLS
from mcp_server.tools import mcp


def _registered_names() -> set[str]:
    return {tool.name for tool in asyncio.run(mcp.list_tools())}


def test_every_intelligence_tool_is_registered():
    """A constant nobody registered is the exact bug tool_names.py exists for.

    Importing the constant succeeds, the call fails at runtime when the tool
    cannot be found -- which is how two of the eight prototype bugs happened.
    """
    missing = sorted(set(INTELLIGENCE_TOOLS) - _registered_names())
    assert not missing, f"declared in tool_names.py but never registered: {missing}"


def test_constants_match_function_names():
    """MCP identifies a tool by its function name, so the two must agree."""
    for name in INTELLIGENCE_TOOLS:
        assert hasattr(intelligence, name), (
            f"{name} is declared but no function of that name exists in "
            "mcp_server/intelligence.py"
        )


def test_github_passthrough_tools_still_registered():
    """F18 adds tools; it must not displace the ones the graph depends on."""
    from mcp_server import tool_names

    for constant in (
        tool_names.GET_ISSUE,
        tool_names.GET_ISSUES,
        tool_names.POST_ISSUE_COMMENT,
        tool_names.ADD_LABELS,
    ):
        assert constant in _registered_names()


@pytest.mark.parametrize("name", INTELLIGENCE_TOOLS)
def test_intelligence_tools_are_read_only(name: str):
    """No intelligence tool may reach a GitHub write function.

    This is the module's one hard safety property. Writes are gated behind the
    decider's approval checks so nothing is posted without a maintainer; a
    read-only tool that quietly gained a write would route an external MCP
    client straight around that gate.

    Checked against the source rather than by calling anything -- a test that
    had to *invoke* a write to prove it was absent would be the bug.
    """
    source = inspect.getsource(getattr(intelligence, name))
    forbidden = (
        "post_issue_comment",
        "post_review_comment",
        "add_labels",
        "create_issue",
        "edit(",
    )
    for token in forbidden:
        assert token not in source, (
            f"{name} references {token!r}: intelligence tools must be read-only"
        )


def test_health_tool_refuses_to_quote_an_unmeasured_score():
    """An unmeasured score must never be presented as health.

    Three of the four sub-scores return 100 for an empty backlog, so the number
    is 100 exactly when it means least. An MCP client has no dashboard context
    to catch that, so the tool says so in words as well as flags.
    """
    import json

    from mcp_server import intelligence as mod

    payload = json.loads(
        json.dumps(
            {
                "score": 100.0,
                "breakdown": {},
                "measured": False,
                "unreadable": False,
                "issue_count": 0,
            }
        )
    )

    # Exercise the summary logic directly against a known-unmeasured result,
    # rather than hitting the live health service.
    def fake_compute(_repo_name, use_cache=True):
        return payload

    original = None
    try:
        from api import health as health_service

        original = health_service.compute
        health_service.compute = fake_compute
        result = json.loads(mod.get_health_score_mcp("owner/repo"))
    finally:
        if original is not None:
            from api import health as health_service

            health_service.compute = original

    assert result["measured"] is False
    assert "Do not report a score" in result["summary"]
