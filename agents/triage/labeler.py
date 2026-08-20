"""Classify the issue and decide which GitHub labels to apply.

Node: labeler
Reads:  issue_metadata, duplicates, security_findings
Writes: labels

Per finalFeatures.md section 8 and agents/CLAUDE.md 4.5: auto-apply above the
confidence threshold (default 0.85); below it, suggest only and await
maintainer approval.

This node never calls GitHub. It only decides what *would* be applied --
`decider` is the sole node with GitHub side effects.
"""

import json
import os
import re

from agents.chain import chain_step
from agents.state import GraphState

# Above this, `decider` may apply labels for real. Below it, the labels are
# suggestions a human approves first. Matches DESIGN.md's autonomy policy:
# "Apply label -- approval required unless explicitly configured."
AUTO_APPLY_THRESHOLD = 0.85

# Closed vocabulary. The LLM is not free to invent labels: an unknown label
# would fail at the GitHub API and, worse, produce a different taxonomy per
# issue, which makes the dashboard's grouping meaningless.
ALLOWED_LABELS = [
    "bug",
    "feature",
    "question",
    "documentation",
    "security",
    "duplicate",
    "performance",
    "enhancement",
]

_PRECEDENT_PROMPT = """You are triaging a GitHub issue for an open-source maintainer.

This repository's maintainers have already classified similar issues. Use their
decisions to infer how this project *categorises* problems, not just what it
calls them -- if they consistently treat breakage of this kind as a bug rather
than an enhancement request, do the same.

Precedents from closed issues in this repository:
{precedents}

IMPORTANT: those precedent labels are this repository's own vocabulary and are
often not in the list you may choose from. Do not copy them. Read what they
imply about the category and then pick the closest label from the allowed list
below. For example, a project labelling a broken integration "site-bug" is
telling you it considers that a bug.

Now the new issue.

Title: {title}

Body:
{body}

Existing labels: {existing}

Choose 1-3 labels from EXACTLY this list, and nothing else: {allowed}

Respond with ONLY a JSON object, no prose, no code fence:
{{"labels": ["..."], "confidence": 0.0, "reason": "one short sentence"}}

confidence is your certainty (0.0-1.0) that these labels are correct."""

_PROMPT = """You are triaging a GitHub issue for an open-source maintainer.

Title: {title}

Body:
{body}

Existing labels: {existing}

Choose 1-3 labels from EXACTLY this list: {allowed}

Respond with ONLY a JSON object, no prose, no code fence:
{{"labels": ["..."], "confidence": 0.0, "reason": "one short sentence"}}

confidence is your certainty (0.0-1.0) that these labels are correct."""


def _precedents(state: GraphState, metadata: dict) -> list[dict]:
    """Closed issues this repository already classified, for few-shot grounding.

    F17. Never raises: the RAG store may be unindexed, empty, or mid-write, and
    a classification that works today must not start failing because precedent
    lookup did. An empty list means "no precedent", which the caller handles by
    using the original prompt.
    """
    try:
        from rag.retriever import find_precedents

        title = metadata.get("title") or ""
        body = (metadata.get("body") or "")[:2000]
        return find_precedents(
            f"{title}\n\n{body}",
            state.get("repo_name") or "",
            exclude_number=state.get("issue_number"),
        )
    except Exception:
        return []


def _render_precedents(precedents: list[dict]) -> str:
    """One line per precedent: number, similarity, and the labels chosen."""
    return "\n".join(
        f"  #{item['number']} ({item['score']:.2f} similar) -- "
        f"maintainer labelled: {', '.join(item['labels'])} -- {item['title']}"
        for item in precedents
    )


def _get_llm():
    """Lazily construct the shared Groq chat model.

    Lazy so that importing this module (for a unit test that never calls the
    LLM path) doesn't require GROQ_API_KEY. Model name from GROQ_MODEL so it
    can be swapped without a code change if Groq deprecates one mid-event.
    """
    from langchain_groq import ChatGroq

    return ChatGroq(model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"))


def _parse_response(text: str) -> dict:
    """Extract the JSON object from an LLM response.

    Models wrap JSON in prose or fences despite instructions, so pull the
    outermost braces rather than trusting the whole string to parse. A bad
    response degrades to zero confidence -- suggest-only -- instead of raising
    and killing the whole investigation.
    """
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {"labels": [], "confidence": 0.0, "reason": "unparseable response"}
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"labels": [], "confidence": 0.0, "reason": "invalid JSON"}

    labels = [
        label
        for label in data.get("labels", [])
        if isinstance(label, str) and label.lower() in ALLOWED_LABELS
    ]
    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "labels": labels,
        "confidence": max(0.0, min(1.0, confidence)),
        "reason": str(data.get("reason", ""))[:200],
    }


@chain_step("labeler", "Classifying and labeling")
def labeler_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Classify the issue and pick candidate labels.

    Deterministic signals are applied on top of the LLM's classification
    rather than being left to it: a security finding or a confirmed duplicate
    is a fact we already established upstream, so those labels are added
    unconditionally. Asking the model to re-derive them would let it disagree
    with evidence we already hold.

    Returns `labels` plus a `suggested` flag. When confidence is below
    AUTO_APPLY_THRESHOLD the labels are still populated -- `decider` reads the
    flag and routes them to human approval instead of applying them.
    """
    metadata = state.get("issue_metadata") or {}
    title = metadata.get("title") or ""
    body = (metadata.get("body") or "")[:4000]  # keep the prompt bounded
    existing = metadata.get("labels") or []

    # F17: ground the classification in this repository's own past decisions.
    #
    # Without precedents the model classifies on general intuition, which is
    # how a project that consistently labels crash reports "bug" gets one
    # labelled "enhancement". With them, the prompt carries the conventions
    # the maintainers actually applied to similar closed issues.
    #
    # No precedents is a normal outcome -- a young repository has none, and an
    # unindexed one has none yet -- so the original prompt stays as the
    # fallback rather than sending an examples section with nothing in it.
    precedents = _precedents(state, metadata)

    if precedents:
        prompt = _PRECEDENT_PROMPT.format(
            precedents=_render_precedents(precedents),
            title=title,
            body=body or "(no body)",
            existing=", ".join(existing) or "(none)",
            allowed=", ".join(ALLOWED_LABELS),
        )
    else:
        prompt = _PROMPT.format(
            title=title,
            body=body or "(no body)",
            existing=", ".join(existing) or "(none)",
            allowed=", ".join(ALLOWED_LABELS),
        )

    try:
        response = _get_llm().invoke(prompt)
        result = _parse_response(getattr(response, "content", "") or "")
    except Exception as exc:
        # A Groq outage or rate limit must not abort the investigation --
        # deterministic signals below still produce a usable result.
        result = {"labels": [], "confidence": 0.0, "reason": f"LLM unavailable: {exc}"}

    labels = list(result["labels"])
    confidence = result["confidence"]
    evidence = [
        {
            "type": "rule",
            "ref": "classification",
            "score": confidence,
            "snippet": result["reason"] or "no reason given",
        }
    ]

    # Each precedent is cited as evidence, not just fed to the prompt. A
    # classification the reader cannot trace back to the decisions that shaped
    # it is the black box this product exists to replace -- "labelled bug
    # because #142 and #203 were" is reviewable; "labelled bug" is not.
    for item in precedents:
        evidence.append({
            "type": "issue",
            "ref": str(item["number"]),
            "score": item["score"],
            "snippet": (
                f"maintainer labelled #{item['number']} "
                f"[{', '.join(item['labels'])}] -- {item['title']}"
            ),
        })

    # Deterministic overrides -- these are established facts, not guesses.
    if state.get("security_findings"):
        if "security" not in labels:
            labels.append("security")
        evidence.append({
            "type": "rule",
            "ref": "security",
            "score": None,
            "snippet": "security label forced by upstream keyword findings",
        })

    if any(d.get("relation") == "duplicate" for d in state.get("duplicates") or []):
        if "duplicate" not in labels:
            labels.append("duplicate")
        evidence.append({
            "type": "rule",
            "ref": "duplicate",
            "score": None,
            "snippet": "duplicate label forced by upstream similarity match",
        })

    # Don't re-apply what the issue already carries.
    existing_lower = {label.lower() for label in existing}
    labels = [label for label in labels if label.lower() not in existing_lower]

    suggested = confidence < AUTO_APPLY_THRESHOLD
    evidence.append({
        "type": "rule",
        "ref": "auto_apply_threshold",
        "score": AUTO_APPLY_THRESHOLD,
        "snippet": (
            f"confidence {confidence:.2f} < {AUTO_APPLY_THRESHOLD} -- suggest only, "
            "await maintainer approval"
            if suggested
            else f"confidence {confidence:.2f} >= {AUTO_APPLY_THRESHOLD} -- eligible for auto-apply"
        ),
    })

    return {
        "labels": labels,
        "labels_confidence": confidence,
        "labels_suggested": suggested,
    }, evidence
