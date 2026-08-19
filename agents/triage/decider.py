"""Final decision: escalate, comment, close as duplicate, or no action.

Node: decider
Reads:  duplicates, security_findings, impact_score, labels
Writes: decision -> {action, reason, confidence}

The ONLY node in the triage graph that performs real GitHub side effects.

Escalation categories per finalFeatures.md section 4: security, stale,
duplicate, high-impact. Low-confidence results are held back rather than
creating noise.
"""

import asyncio
import json
import os

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from agents.chain import chain_step
from agents.state import GraphState
from mcp_server.tool_names import ADD_LABELS, POST_ISSUE_COMMENT

# Above this, an issue is worth a maintainer's attention on impact alone.
HIGH_IMPACT_THRESHOLD = 70

# See _SERVER_PARAMS note in issue_fetcher: -m form puts repo root on sys.path.
_SERVER_PARAMS = StdioServerParameters(
    command="python",
    args=["-m", "mcp_server.server"],
)


def _writes_enabled() -> bool:
    """Whether this run may touch GitHub.

    DEMO_MODE=1 makes the graph fully inert against the real world -- it
    decides and explains, but posts nothing. That is what lets the demo be
    rehearsed repeatedly against a live repo without spamming it, and what
    makes a dry run safe if the token has write scope.
    """
    return os.getenv("DEMO_MODE", "0") != "1"


async def _apply(repo_name: str, issue_number: int, comment: str, labels: list[str]) -> dict:
    """Post the comment and add labels in one MCP session."""
    applied = {"comment": False, "labels": []}
    async with stdio_client(_SERVER_PARAMS) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            if comment:
                await session.call_tool(
                    POST_ISSUE_COMMENT,
                    {"repo_name": repo_name, "issue_number": issue_number,
                     "comment": comment},
                )
                applied["comment"] = True
            if labels:
                result = await session.call_tool(
                    ADD_LABELS,
                    {"repo_name": repo_name, "issue_number": issue_number,
                     "labels": labels},
                )
                applied["labels"] = json.loads(result.content[0].text)
    return applied


def _decide(state: GraphState) -> dict:
    """Pick exactly one action. Pure -- no side effects, so it is testable.

    Priority order is deliberate: security outranks duplicate. A vulnerability
    reported twice is still a vulnerability, and silently closing it as a dup
    would bury the thing most worth a human's attention.
    """
    security = state.get("security_findings") or []
    duplicates = state.get("duplicates") or []
    impact = state.get("impact_score", 0)
    confirmed_dupes = [d for d in duplicates if d.get("relation") == "duplicate"]

    if security:
        keywords = ", ".join(f["keyword"] for f in security[:3])
        return {
            "action": "escalate",
            "reason": f"Potential security concern ({keywords}). Needs a maintainer's review.",
            "confidence": 0.9,
        }

    if confirmed_dupes:
        best = max(confirmed_dupes, key=lambda d: d["score"])
        return {
            "action": "close_duplicate",
            "reason": f"Appears to duplicate #{best['number']} (similarity {best['score']:.2f}).",
            "confidence": float(best["score"]),
        }

    if impact >= HIGH_IMPACT_THRESHOLD:
        return {
            "action": "escalate",
            "reason": f"High impact score ({impact}/100) from engagement and labels.",
            "confidence": 0.75,
        }

    related = [d for d in duplicates if d.get("relation") == "related"]
    if related:
        refs = ", ".join(f"#{d['number']}" for d in related[:3])
        return {
            "action": "comment",
            "reason": f"Related prior issues found ({refs}); surfacing them for context.",
            "confidence": 0.6,
        }

    return {
        "action": "no_action",
        "reason": f"Triaged: no security signal, no duplicate, impact {impact}/100.",
        "confidence": 0.5,
    }


def _compose_comment(decision: dict, state: GraphState) -> str:
    """Build the comment body, or "" when the action posts nothing.

    Never names the matched security keywords in a public comment. DESIGN.md
    section 12 makes suspected vulnerabilities private by default -- posting
    "we think there is an auth bypass here" is disclosure, so the public text
    stays deliberately vague and the detail lives in the dashboard.
    """
    action = decision["action"]

    if action == "close_duplicate":
        dupes = [d for d in state.get("duplicates") or [] if d.get("relation") == "duplicate"]
        best = max(dupes, key=lambda d: d["score"])
        return (
            f"This looks like a duplicate of #{best['number']} "
            f"(semantic similarity {best['score']:.2f}).\n\n"
            "Flagged automatically by Doombot for maintainer review. "
            "If this is a distinct problem, say so and it will be reopened for triage."
        )

    if action == "comment":
        related = [d for d in state.get("duplicates") or [] if d.get("relation") == "related"]
        refs = "\n".join(f"- #{d['number']} — {d['title']} ({d['score']:.2f})" for d in related[:3])
        return (
            "Doombot found related prior issues that may provide context:\n\n"
            f"{refs}\n\nThis is context only, not a duplicate determination."
        )

    if action == "escalate":
        return (
            "Doombot has flagged this issue for maintainer review.\n\n"
            f"{decision['reason']}"
        )

    return ""


@chain_step("decider", "Deciding next action")
def decider_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Choose an action and perform the approved GitHub side effects.

    Labels are applied only when the labeler cleared its confidence
    threshold. Below it, they stay suggestions for a human -- per DESIGN.md's
    autonomy policy, applying a label is approval-required by default.

    Closing is never performed here. The contract says not to silently no-op
    a close, so the action is recorded and the comment posted, but the issue
    is left open for a maintainer to close.
    """
    decision = _decide(state)
    comment = _compose_comment(decision, state)

    labels = state.get("labels") or []
    suggested = state.get("labels_suggested", True)
    labels_to_apply = [] if suggested else labels

    evidence = [
        {
            "type": "rule",
            "ref": decision["action"],
            "score": decision["confidence"],
            "snippet": decision["reason"],
        }
    ]

    if not _writes_enabled():
        evidence.append({
            "type": "rule", "ref": "demo_mode", "score": None,
            "snippet": "DEMO_MODE=1 — decision recorded, nothing posted to GitHub",
        })
        return {"decision": {**decision, "applied": None}}, evidence

    applied = None
    if comment or labels_to_apply:
        try:
            applied = asyncio.run(
                _apply(state["repo_name"], state["issue_number"], comment, labels_to_apply)
            )
        except Exception as exc:
            # A failed write must not lose the decision -- the dashboard still
            # shows what Doombot concluded and that the write needs a retry.
            evidence.append({
                "type": "rule", "ref": "write_failed", "score": None,
                "snippet": f"GitHub write failed: {exc}",
            })
            return {"decision": {**decision, "applied": {"error": str(exc)}}}, evidence

    if suggested and labels:
        evidence.append({
            "type": "rule", "ref": "labels_suggested", "score": None,
            "snippet": f"labels {labels} held for approval (below confidence threshold)",
        })

    return {"decision": {**decision, "applied": applied}}, evidence
