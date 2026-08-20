"""Final decision: escalate, auto-comment, or close as duplicate.

Node: decider
Reads:  duplicates, security_findings, impact_score, labels
Writes: decision  -> {action, reason, confidence}

Escalation categories (finalFeatures.md section 4): security, stale,
duplicate, high-impact. Low-confidence results are held back rather than
creating noise. Performs the real GitHub side effects (comment + labels)
via the shared MCP client.
"""
from agents.chain import chain_step
from mcp_server.client import call_tool_sync
from mcp_server.tool_names import POST_ISSUE_COMMENT

DUPLICATE_SCORE_THRESHOLD = 0.85
RELATED_SCORE_THRESHOLD = 0.65
SECURITY_IMPACT_THRESHOLD = 50
HIGH_IMPACT_THRESHOLD = 70
LOW_IMPACT_THRESHOLD = 30


@chain_step(name="decider", title="Making final decision")
def decider(state):
    duplicates = state.get("duplicates", []) or []
    security_findings = state.get("security_findings", []) or []
    impact_score = state.get("impact_score", 0) or 0
    repo_name = state["repo_name"]
    issue_number = state["issue_number"]

    tool_calls = []
    top_duplicate = None
    top_duplicate_score = -1.0
    for entry in duplicates:
        score = entry.get("score", 0)
        if score > DUPLICATE_SCORE_THRESHOLD and score > top_duplicate_score:
            top_duplicate = entry
            top_duplicate_score = score

    if top_duplicate is not None:
        action = "close_as_duplicate"
        reason = f"Matches issue #{top_duplicate['number']} at {top_duplicate_score:.0%} similarity"
        confidence = top_duplicate_score

        try:
            call_tool_sync(
                POST_ISSUE_COMMENT,
                {
                    "repo_name": repo_name,
                    "issue_number": issue_number,
                    "comment": (
                        f"This looks like a duplicate of #{top_duplicate['number']} "
                        f"({top_duplicate.get('title', '')})."
                    ),
                },
            )
            tool_calls.append(POST_ISSUE_COMMENT)
        except Exception:
            pass

    elif len(security_findings) > 0 and impact_score >= SECURITY_IMPACT_THRESHOLD:
        action = "escalate"
        reason = "Security-sensitive issue with meaningful impact"
        confidence = 0.85

    elif impact_score >= HIGH_IMPACT_THRESHOLD:
        action = "escalate"
        reason = f"High impact score ({impact_score}/100)"
        confidence = 0.75

    elif (
        impact_score < LOW_IMPACT_THRESHOLD
        and len(security_findings) == 0
        and all(entry.get("score", 0) <= RELATED_SCORE_THRESHOLD for entry in duplicates)
    ):
        action = "auto_comment"
        reason = "Low impact, no red flags — acknowledging without escalation"
        confidence = 0.6

        try:
            call_tool_sync(
                POST_ISSUE_COMMENT,
                {
                    "repo_name": repo_name,
                    "issue_number": issue_number,
                    "comment": (
                        "Thanks for the report — this has been triaged and doesn't "
                        "currently need maintainer escalation."
                    ),
                },
            )
            tool_calls.append(POST_ISSUE_COMMENT)
        except Exception:
            pass

    else:
        action = "hold"
        reason = "Insufficient signal to confidently escalate or dismiss"
        confidence = 0.4

    patch = {"decision": {"action": action, "reason": reason, "confidence": confidence}}
    evidence = [
        {
            "type": "decision",
            "ref": action,
            "score": confidence,
            "snippet": reason,
        }
    ]
    return patch, evidence, tool_calls
