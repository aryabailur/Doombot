from typing import Annotated
from operator import add
from typing_extensions import TypedDict


class GraphState(TypedDict, total=False):
    """Shared state for both the PR-review graph and the issue-triage graph.

    Every field is optional (`total=False`) because no single node touches
    every key -- LangGraph only requires that a node's return dict be a
    subset of the schema.

    `review_metadata` and `chain` use the `add` reducer deliberately: both
    are append-only logs contributed to by more than one node invocation.
    Every other field is last-write-wins, LangGraph's default.
    """

    # --- PR review graph (existing, do not change semantics) ---
    repo_name: str                               # "owner/repo", set by the caller
    pr_number: int                               # PR being reviewed
    pr_metadata: dict                            # title/body/state/username
    diff_files: list[dict]                       # [{"name": ..., "differences": <unified diff>}]
    review_metadata: Annotated[list[dict], add]  # reviewer findings, accumulated
    test_metadata: str                           # LLM prose; one node writes it once
    summary_metadata: str                        # final PR review comment text

    # --- Issue triage graph (new) ---
    investigation_id: str          # UUID assigned by the API layer before invoking issue_app
    issue_number: int              # issue being triaged
    issue_metadata: dict           # title/body/labels/reactions/comments/author/created_at
    duplicates: list[dict]         # [{"number": int, "score": float, "relation": "duplicate"|"related"}]
    security_findings: list[dict]  # [{"keyword": str, "context": str}]
    impact_score: int              # 0-100, from impact_scorer
    labels: list[str]              # labels chosen by labeler
    labels_confidence: float       # labeler's certainty, 0.0-1.0
    labels_suggested: bool         # True => below threshold, decider must not auto-apply
    resolution: dict | None        # F16: {source_issue, reply, confidence, auto_post, posted}
    decision: dict                 # {"action": ..., "reason": ..., "confidence": float}
    auto_fix_plan: dict | None     # applicability check from patch_checker
    auto_fix: dict | None          # draft-PR result from fix_pr_opener
    chain: Annotated[list[dict], add]  # StepRecord log; every node appends exactly one
