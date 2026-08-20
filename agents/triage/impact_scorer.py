"""Score issue impact 0-100.

Node: impact_scorer
Reads:  issue_metadata, duplicates, security_findings
Writes: impact_score

Formula (weights are a deliberate, documented judgment call — tune here if
the dashboard/decider need different sensitivity):
    +40  if any security_findings exist (security issues are inherently
         high impact regardless of anything else about the issue)
    +5   per entry in duplicates, capped at +20 (more people hitting the
         same problem == higher impact, but a handful of matches already
         says enough — no need for an unbounded climb)
    +30  if any label in issue_metadata["labels"] contains "critical",
         "urgent", "p0", or "p1" (case-insensitive) — maintainer-asserted
         urgency is a strong, direct signal
    +10  baseline, so an issue with none of the above signals still reads
         as "some impact" rather than a hard 0
Final score is clamped to [0, 100].
"""
from agents.chain import chain_step

SECURITY_BONUS = 40
DUPLICATE_WEIGHT = 5
DUPLICATE_CAP = 20
LABEL_BONUS = 30
BASELINE = 10
URGENT_LABEL_MARKERS = ("critical", "urgent", "p0", "p1")


@chain_step(name="impact_scorer", title="Scoring issue impact")
def impact_scorer(state):
    issue_metadata = state.get("issue_metadata", {}) or {}
    duplicates = state.get("duplicates", []) or []
    security_findings = state.get("security_findings", []) or []

    score = BASELINE

    if len(security_findings) > 0:
        score += SECURITY_BONUS

    score += min(len(duplicates) * DUPLICATE_WEIGHT, DUPLICATE_CAP)

    labels = issue_metadata.get("labels", []) or []
    if any(
        marker in label.lower()
        for label in labels
        for marker in URGENT_LABEL_MARKERS
    ):
        score += LABEL_BONUS

    score = max(0, min(100, int(score)))

    patch = {"impact_score": score}
    evidence = [
        {
            "type": "impact",
            "ref": "impact_score",
            "score": score / 100,
            "snippet": (
                f"Impact score {score}/100 based on {len(security_findings)} "
                f"security signal(s) and {len(duplicates)} related report(s)"
            ),
        }
    ]
    return patch, evidence
