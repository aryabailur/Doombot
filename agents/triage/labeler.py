"""Classify the issue and decide which GitHub labels to apply.

Node: labeler
Reads:  issue_metadata, duplicates, security_findings
Writes: labels

Per finalFeatures.md section 8: auto-apply above the confidence threshold
(default 0.85); below it, suggest only and await maintainer approval.

Security findings are never auto-applied regardless of confidence — per
docs/DESIGN.md §12, publishing a security-sensitive label to a public issue
is prohibited without explicit maintainer approval. SECURITY_LABEL always
goes through the suggested_actions/Approval Center path.
"""
from agents.chain import chain_step
from mcp_server.client import call_tool_sync
from mcp_server.tool_names import ADD_LABELS

AUTO_APPLY_THRESHOLD = 0.85

SECURITY_LABEL = "security-sensitive"
SECURITY_CONFIDENCE = 0.9

DUPLICATE_LABEL = "duplicate"
DUPLICATE_SCORE_THRESHOLD = 0.85

HIGH_IMPACT_LABEL = "high-impact"
HIGH_IMPACT_THRESHOLD = 70
HIGH_IMPACT_CONFIDENCE = 0.8

# Labels that must never be auto-applied even above AUTO_APPLY_THRESHOLD —
# always routed to the approval queue instead.
APPROVAL_REQUIRED_LABELS = {SECURITY_LABEL}


@chain_step(name="labeler", title="Determining labels")
def labeler(state):
    issue_metadata = state.get("issue_metadata", {}) or {}
    duplicates = state.get("duplicates", []) or []
    security_findings = state.get("security_findings", []) or []

    candidates = []  # list of (label, confidence)

    if len(security_findings) > 0:
        candidates.append((SECURITY_LABEL, SECURITY_CONFIDENCE))

    top_duplicate_score = max(
        (entry.get("score", 0) for entry in duplicates if entry.get("score", 0) > DUPLICATE_SCORE_THRESHOLD),
        default=None,
    )
    if top_duplicate_score is not None:
        candidates.append((DUPLICATE_LABEL, top_duplicate_score))

    if "impact_score" in state and state["impact_score"] >= HIGH_IMPACT_THRESHOLD:
        candidates.append((HIGH_IMPACT_LABEL, HIGH_IMPACT_CONFIDENCE))

    auto_apply_labels = [
        label
        for label, confidence in candidates
        if confidence >= AUTO_APPLY_THRESHOLD and label not in APPROVAL_REQUIRED_LABELS
    ]

    tool_calls = []
    applied_ok = False
    if auto_apply_labels:
        try:
            call_tool_sync(
                ADD_LABELS,
                {
                    "repo_name": state["repo_name"],
                    "issue_number": state["issue_number"],
                    "labels": auto_apply_labels,
                },
            )
            tool_calls.append(ADD_LABELS)
            applied_ok = True
        except Exception:
            # GitHub API failure (bad token, rate limit, etc.) must not
            # crash the graph. applied_ok stays False so the evidence
            # below honestly reflects that the write never actually
            # happened, instead of claiming "applied" regardless.
            pass

    all_labels = [label for label, _ in candidates]

    def snippet_for(label: str, confidence: float) -> str:
        if label in APPROVAL_REQUIRED_LABELS:
            return "suggested"
        if confidence >= AUTO_APPLY_THRESHOLD:
            return "applied" if applied_ok else "apply_failed"
        return "suggested"

    patch = {"labels": all_labels}
    evidence = [
        {
            "type": "label",
            "ref": label,
            "score": confidence,
            "snippet": snippet_for(label, confidence),
        }
        for label, confidence in candidates
    ]
    return patch, evidence, tool_calls
