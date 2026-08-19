"""Score issue impact 0-100.

Node: impact_scorer
Reads:  issue_metadata, duplicates, security_findings
Writes: impact_score

Pure arithmetic, no LLM/network call -- see `impact_scorer_node` docstring
for the exact formula. Every component is independently capped so no single
noisy field (e.g. a bot inflating `comments`) can dominate the score, and the
whole thing is clamped to 0..100 at the end as a final safety net.
"""

from datetime import datetime, timezone

from agents.chain import chain_step
from agents.state import GraphState

# Labels that indicate a pre-existing, human-confirmed problem rather than a
# fresh/unverified report -- these raise the score once, not per matching label.
_HIGH_IMPACT_LABELS = {"bug", "regression"}


def _age_days(created_at) -> float | None:
    """Parse `created_at` (ISO-8601) into an age in days, defensively.

    Returns None (not 0) on missing/unparseable input so the caller can tell
    "no signal" apart from "zero days old" -- both should contribute 0 age
    points, but for different reasons, and keeping them distinct makes the
    evidence trail honest rather than silently pretending the issue is brand new.
    """
    if not created_at or not isinstance(created_at, str):
        return None
    try:
        # datetime.fromisoformat handles "...+00:00"; normalize a trailing "Z"
        # (common in GitHub API timestamps) since fromisoformat rejects it
        # on Python < 3.11.
        normalized = created_at.replace("Z", "+00:00")
        created = datetime.fromisoformat(normalized)
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = (now - created).total_seconds() / 86400.0
        return max(delta, 0.0)
    except (ValueError, TypeError):
        return None


def _age_points(age_days: float | None) -> tuple[int, str]:
    """Bucket issue age into points, capped at 15.

    Weighting choice: age is treated as "long-standing pain" (still open and
    still relevant) rather than pure staleness, because staleness-as-decay
    would systematically under-rank exactly the old, unresolved issues a
    triage tool most needs to surface. The curve is front-loaded and capped
    so a 5-year-old issue doesn't outweigh a security finding or dominate the
    score just for being old:
        < 7 days    -> 0   (too new to judge)
        7-30 days   -> 5   (a few weeks unresolved)
        30-90 days  -> 10  (over a month, likely genuinely stuck)
        > 90 days   -> 15  (long-standing, cap)
    """
    if age_days is None:
        return 0, "created_at missing or unparseable -- no age signal"
    if age_days < 7:
        return 0, f"issue is {age_days:.1f} days old -- too new to weight"
    if age_days < 30:
        return 5, f"issue is {age_days:.1f} days old (1-4 weeks, unresolved)"
    if age_days < 90:
        return 10, f"issue is {age_days:.1f} days old (1-3 months, likely stuck)"
    return 15, f"issue is {age_days:.1f} days old (90+ days, long-standing)"


@chain_step("impact_scorer", "Scoring impact")
def impact_scorer_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Combine deterministic signals into a single 0-100 impact score.

    FORMULA (each component's max contribution noted; final score clamped to
    0..100):

        base                     = +5                    (flat, every issue starts here)
        reactions   contribution = +min(reactions * 2, 20)   (max 20)
        comments    contribution = +min(comments * 2, 15)    (max 15)
        participants contribution = +min(participants * 3, 15) (max 15)
        age         contribution = +0/5/10/15 bucketed by days open (max 15,
                                     see `_age_points` -- rewards long-standing
                                     unresolved issues, not raw staleness)
        labels      contribution = +15 if "bug" or "regression" in labels,
                                     else +0 (checked once, not per label)
        security    contribution = +30 if security_findings is non-empty,
                                     else +0 (security is high-impact by
                                     default -- the single largest lever)
        duplicate   contribution = -40 if any duplicates entry has
                                     relation == "duplicate", else +0
                                     (a confirmed dup should never rank as
                                     urgent, regardless of its other signals)

        raw   = base + reactions + comments + participants + age + labels
                + security + duplicate
        score = clamp(round(raw), 0, 100)

    Max theoretical positive total before the duplicate penalty and before
    clamping: 5 + 20 + 15 + 15 + 15 + 15 + 30 = 115 (clamped down to 100).
    A totally empty `issue_metadata` yields just the +5 base, clamped into
    range, i.e. a low score of 5.

    This function is pure arithmetic: no LLM call, no network call,
    deterministic given its inputs. Every contributing signal is also
    emitted as a `type: "rule"` evidence item so the score is explainable in
    the dashboard rather than a magic number.
    """
    issue_metadata = state.get("issue_metadata") or {}
    duplicates = state.get("duplicates") or []
    security_findings = state.get("security_findings") or []

    evidence: list[dict] = []
    raw = 5  # base, always contributes -- see docstring
    evidence.append(
        {
            "type": "rule",
            "ref": "base",
            "score": 5,
            "snippet": "flat baseline applied to every triaged issue",
        }
    )

    # --- reactions ---
    reactions = issue_metadata.get("reactions")
    reactions = reactions if isinstance(reactions, (int, float)) and reactions > 0 else 0
    reactions_pts = min(int(reactions) * 2, 20)
    raw += reactions_pts
    if reactions_pts:
        evidence.append(
            {
                "type": "rule",
                "ref": "reactions",
                "score": reactions_pts,
                "snippet": f"{int(reactions)} reaction(s) -- capped at 20 pts",
            }
        )

    # --- comments ---
    comments = issue_metadata.get("comments")
    comments = comments if isinstance(comments, (int, float)) and comments > 0 else 0
    comments_pts = min(int(comments) * 2, 15)
    raw += comments_pts
    if comments_pts:
        evidence.append(
            {
                "type": "rule",
                "ref": "comments",
                "score": comments_pts,
                "snippet": f"{int(comments)} comment(s) -- capped at 15 pts",
            }
        )

    # --- participants ---
    participants = issue_metadata.get("participants")
    participants = (
        participants if isinstance(participants, (int, float)) and participants > 0 else 0
    )
    participants_pts = min(int(participants) * 3, 15)
    raw += participants_pts
    if participants_pts:
        evidence.append(
            {
                "type": "rule",
                "ref": "participants",
                "score": participants_pts,
                "snippet": f"{int(participants)} distinct participant(s) -- capped at 15 pts",
            }
        )

    # --- age ---
    age_pts, age_snippet = _age_points(_age_days(issue_metadata.get("created_at")))
    raw += age_pts
    if age_pts:
        evidence.append(
            {"type": "rule", "ref": "age", "score": age_pts, "snippet": age_snippet}
        )

    # --- labels ---
    labels = issue_metadata.get("labels") or []
    if isinstance(labels, list) and any(
        isinstance(lbl, str) and lbl.lower() in _HIGH_IMPACT_LABELS for lbl in labels
    ):
        raw += 15
        evidence.append(
            {
                "type": "rule",
                "ref": "labels",
                "score": 15,
                "snippet": f"pre-existing bug/regression label present: {labels}",
            }
        )

    # --- security findings (push UP) ---
    if security_findings:
        raw += 30
        evidence.append(
            {
                "type": "rule",
                "ref": "security_findings",
                "score": 30,
                "snippet": (
                    f"{len(security_findings)} security keyword hit(s) -- "
                    "security issues are high-impact by default"
                ),
            }
        )

    # --- duplicates (push DOWN) ---
    is_duplicate = any(
        isinstance(d, dict) and d.get("relation") == "duplicate" for d in duplicates
    )
    if is_duplicate:
        raw -= 40
        evidence.append(
            {
                "type": "rule",
                "ref": "duplicates",
                "score": -40,
                "snippet": "matched an existing issue as a confirmed duplicate -- de-prioritized",
            }
        )

    score = max(0, min(100, round(raw)))
    return {"impact_score": score}, evidence
