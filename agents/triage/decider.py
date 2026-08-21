"""Final decision: escalate, comment, close as duplicate, or no action.

Node: decider
Reads:  duplicates, security_findings, impact_score, labels
Writes: decision -> {action, reason, confidence, proposal}

This node is draft-only. It records the exact GitHub change for review; the
API approval endpoint owns every real side effect.

Escalation categories per finalFeatures.md section 4: security, stale,
duplicate, high-impact. Low-confidence results are held back rather than
creating noise.
"""

import json
import os

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from agents.chain import chain_step
from agents.state import GraphState
from mcp_server.tool_names import ADD_LABELS, GET_ISSUE_COMMENTS, POST_ISSUE_COMMENT
import sys

# Above this, an issue is worth a maintainer's attention on impact alone.
HIGH_IMPACT_THRESHOLD = 70

# See _SERVER_PARAMS note in issue_fetcher: -m form puts repo root on sys.path.
_SERVER_PARAMS = StdioServerParameters(
    command=sys.executable,
    args=["-m", "mcp_server.server"],
)


def _root_cause(exc: BaseException, depth: int = 0) -> str:
    """Unwrap an exception to the most specific message available.

    MCP runs tool calls inside an anyio task group, so any failure surfaces as
    an ExceptionGroup whose str() is "unhandled errors in a TaskGroup (1
    sub-exception)" -- true and useless. The operator needs to see "403
    Forbidden", which is the difference between "my token lacks Issues:write"
    and "something broke."
    """
    if depth > 5:
        return str(exc)
    inner = getattr(exc, "exceptions", None)
    if inner:
        return _root_cause(inner[0], depth + 1)
    if exc.__cause__ is not None:
        return _root_cause(exc.__cause__, depth + 1)
    return f"{type(exc).__name__}: {exc}"


def writes_enabled() -> bool:
    """Whether this run may touch GitHub.

    DEMO_MODE=1 makes the graph fully inert against the real world -- it
    decides and explains, but posts nothing. That is what lets the demo be
    rehearsed repeatedly against a live repo without spamming it, and what
    makes a dry run safe if the token has write scope.
    """
    return os.getenv("DEMO_MODE", "0") != "1"


def _tool_text(result) -> str:
    """Extract text from an MCP tool result, raising if the call failed.

    MCP reports tool failures via `isError` on an otherwise well-formed
    response -- it does not raise. Without this check a 403 from GitHub looks
    like success, and the dashboard would claim a comment was posted that
    never was. Reporting a write that did not happen is worse than failing.
    """
    text = result.content[0].text if result.content else ""
    if getattr(result, "isError", False):
        raise RuntimeError(text or "MCP tool call failed")
    return text


# Every Doombot comment carries this marker so a later run can recognise its
# own prior output. Rendered as an HTML comment, so it is invisible on GitHub
# but present in the raw body the API returns.
COMMENT_MARKER = "<!-- doombot -->"


async def _already_commented(session, repo_name: str, issue_number: int) -> bool:
    """Whether Doombot has already commented on this issue.

    finalFeatures.md 9 requires not posting the same request twice before the
    author responds, and re-running an investigation is routine -- during
    debugging, after a crash, or when a maintainer re-triggers it. Without
    this check each run appends another identical comment, which is exactly
    the notification noise the product claims to reduce.
    """
    result = await session.call_tool(
        GET_ISSUE_COMMENTS,
        {"repo_name": repo_name, "issue_number": issue_number},
    )
    return any(COMMENT_MARKER in c.get("body", "") for c in json.loads(_tool_text(result)))


async def apply_approved_action(
    repo_name: str,
    issue_number: int,
    comment: str,
    labels: list[str],
) -> dict:
    """Post the comment and add labels in one MCP session.

    Idempotent: a second run on the same issue adds labels that are missing
    but does not repeat a comment Doombot already left.
    """
    applied = {"comment": False, "labels": [], "comment_skipped": False}
    async with stdio_client(_SERVER_PARAMS) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            if comment and await _already_commented(session, repo_name, issue_number):
                applied["comment_skipped"] = True
                comment = ""
            if comment:
                result = await session.call_tool(
                    POST_ISSUE_COMMENT,
                    {"repo_name": repo_name, "issue_number": issue_number,
                     "comment": comment},
                )
                _tool_text(result)
                applied["comment"] = True
            if labels:
                result = await session.call_tool(
                    ADD_LABELS,
                    {"repo_name": repo_name, "issue_number": issue_number,
                     "labels": labels},
                )
                applied["labels"] = json.loads(_tool_text(result))
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

    # A grounded fix from the repo's own history outranks closing as a
    # duplicate: telling the author how to solve it is strictly more useful
    # than pointing at another open thread. Still ranked below security.
    resolution = state.get("resolution")
    if resolution and resolution.get("reply"):
        return {
            "action": "resolve",
            "reason": (
                f"A known fix from #{resolution['source_issue']} appears to apply "
                f"(similarity {resolution['similarity']:.2f})."
            ),
            "confidence": float(resolution.get("confidence", 0.0)),
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

    if action == "resolve":
        resolution = state.get("resolution") or {}
        # The drafted reply is the comment. It already cites its source issue
        # and was self-checked for addressing THIS issue; wrapping it in extra
        # boilerplate would only dilute it.
        note = (
            f"_Suggested by Doombot from #{resolution.get('source_issue')}. "
            "If this does not help, say so and it will be escalated._"
        )
        return f"{resolution.get('reply', '')}\n\n{note}"

    if action == "escalate":
        # NEVER interpolate decision["reason"] here. For a security escalation
        # that string names the matched keywords ("api key", "auth bypass"),
        # and DESIGN.md 12 keeps suspected vulnerabilities private by default
        # -- publishing the specifics on a public issue IS the disclosure the
        # policy forbids. The detail belongs in the dashboard, which is
        # access-controlled; the public comment only says a human should look.
        if state.get("security_findings"):
            return (
                "Doombot has flagged this issue for maintainer review.\n\n"
                "Details are available to maintainers in the Doombot dashboard."
            )
        return (
            "Doombot has flagged this issue for maintainer review.\n\n"
            f"{decision['reason']}"
        )

    return ""


@chain_step("decider", "Deciding next action")
def decider_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Choose an action and draft, but never perform, GitHub side effects.

    Investigation is autonomous; public writes are approval-controlled. The
    exact comment and labels are returned inside ``decision.proposal`` so the
    API can persist them, show them verbatim to a maintainer, and execute them
    exactly once after approval. Keeping execution out of the graph also makes
    replays and retries safe: rerunning a node cannot post twice.

    Closing remains a recommendation only. There is no close tool in the
    approved action executor, so a duplicate proposal contains a comment and
    labels while the issue remains open for a maintainer.
    """
    decision = _decide(state)
    # Draft public text from issue evidence only. Maintainer preference history
    # belongs in the private trace and must not leak into a GitHub comment.
    comment = _compose_comment(decision, state)
    policy = state.get("repository_policy") or {}
    action_policy = next(
        (
            item for item in policy.get("actions", [])
            if item.get("action") == decision["action"]
        ),
        None,
    )
    if action_policy:
        decision["policy"] = {
            "mode": policy.get("mode", "observing"),
            **action_policy,
        }
        if action_policy.get("samples", 0) >= policy.get("minimum_samples", 3):
            decision["reason"] += (
                " Maintainer policy history: "
                f"{action_policy.get('approvals', 0)} of "
                f"{action_policy.get('samples', 0)} similar proposals approved "
                f"({action_policy.get('guidance', 'mixed')})."
            )
    if comment:
        comment = comment + "\n\n" + COMMENT_MARKER

    labels = state.get("labels") or []
    proposal = None
    if comment or labels:
        proposal = {
            "comment": comment,
            "labels": labels,
            "requires_approval": True,
        }

    evidence = [
        {
            "type": "rule",
            "ref": decision["action"],
            "score": decision["confidence"],
            "snippet": decision["reason"],
        }
    ]

    if proposal:
        evidence.append({
            "type": "rule", "ref": "approval_required", "score": None,
            "snippet": (
                "GitHub comment and label changes are proposed only; a "
                "maintainer must approve the exact payload before execution"
            ),
        })

    if action_policy:
        evidence.append({
            "type": "rule",
            "ref": "repository_policy",
            "score": action_policy.get("approval_rate"),
            "snippet": (
                f"Repository history for {decision['action']}: "
                f"{action_policy.get('approvals', 0)} approved and "
                f"{action_policy.get('rejections', 0)} rejected; guidance is "
                f"{action_policy.get('guidance', 'observing')}. This does not "
                "bypass approval or replace evidence confidence."
            ),
        })

    if not writes_enabled():
        evidence.append({
            "type": "rule", "ref": "demo_mode", "score": None,
            "snippet": (
                "DEMO_MODE=1 — decision and proposal recorded; approved "
                "actions remain blocked from GitHub"
            ),
        })

    return {
        "decision": {**decision, "proposal": proposal, "applied": None}
    }, evidence
