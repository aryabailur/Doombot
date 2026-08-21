"""Intelligent issue resolution (F16).

Node: resolver
Reads:  repo_name, issue_number, issue_metadata
Writes: resolution

Searches the repo's *closed* issues for one that was actually solved, reads
how it was solved, and drafts a response connecting that fix to the new
issue.

What separates this from a chatbot: it is grounded in the project's own
history. It finds a specific prior issue, reads the specific fix applied, and
cites both. When it cannot find a grounded resolution it stays silent rather
than guessing -- an ungrounded answer on a public issue is worse than no
answer, because it costs the maintainer trust as well as time.

Runs between `duplicate_detector` and `security_scanner`: it needs the
similarity search, and it must not pre-empt a security escalation.
"""

from __future__ import annotations

import json
import os
import re

from agents.chain import chain_step
from agents.state import GraphState

# Lower than the 0.85 duplicate bar on purpose. A resolution does not require
# the issues be the *same* report -- only that the old fix plausibly applies.
RESOLUTION_THRESHOLD = 0.75

# Above this the write is allowed to happen automatically, when auto-posting
# is enabled at all. Below it, the draft is stored for approval.
AUTO_POST_CONFIDENCE = 0.80

_DRAFT_PROMPT = """A maintainer is triaging a new GitHub issue. A previously
closed issue looks similar and was resolved.

NEW ISSUE
Title: {new_title}
Body: {new_body}

PREVIOUSLY RESOLVED ISSUE (#{old_number})
Title: {old_title}
How it was resolved: {resolution}

Write a short reply to the NEW issue that connects the old fix to it. Rules:
- Address the new issue's specific details. Do not restate the old issue.
- Cite #{old_number} explicitly.
- If the fix likely already shipped, ask the author to confirm their version.
- Never invent a version number, config key, or file path not present above.
- Three sentences maximum. No greeting, no sign-off.

Then judge your own reply: does it genuinely address THIS issue, or does it
only describe the old one?

Respond with ONLY a JSON object, no prose, no code fence:
{{"reply": "...", "addresses_new_issue": true, "confidence": 0.0,
  "reason": "one short sentence"}}

confidence is how likely this reply actually helps the author."""


def _get_llm():
    """Lazily construct the Groq chat model, so imports need no API key."""
    from langchain_groq import ChatGroq

    return ChatGroq(model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"))


def auto_post_enabled() -> bool:
    """Whether a resolution may be posted without a human approving it.

    Off by default. DESIGN.md 12's autonomy table makes "publish public
    comment" approval-required unless explicitly configured, and this is the
    riskiest write in the product: a wrong answer posted under the project's
    name is worse than silence.

    DOOMBOT_AUTO_RESOLVE=1 opts in. DEMO_MODE=1 always wins, so a rehearsal
    against a live repo can never post.
    """
    if os.getenv("DEMO_MODE", "0") == "1":
        return False
    return os.getenv("DOOMBOT_AUTO_RESOLVE", "0") == "1"


def _find_resolved_match(state: GraphState) -> dict | None:
    """Closest *closed* issue above the resolution threshold.

    Reuses the duplicates the previous node already retrieved rather than
    re-querying Chroma -- one search per investigation, not two.
    """
    from rag.retriever import find_duplicates

    metadata = state.get("issue_metadata") or {}
    query = f"{metadata.get('title') or ''}\n\n{metadata.get('body') or ''}"

    result = find_duplicates(
        query, state["repo_name"], exclude_number=state.get("issue_number")
    )
    candidates = [
        match
        for match in result["duplicates"] + result["related"]
        if match["score"] >= RESOLUTION_THRESHOLD
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda match: match["score"])


def _resolution_context(repo_name: str, number: int) -> str | None:
    """How issue `number` was resolved, or None if it was not.

    A closed issue is not a resolved issue -- plenty are closed as stale, as
    duplicates, or with no explanation. Only a closing comment of real
    substance counts as something to build a reply on.
    """
    from mcp_server.github_client import get_issue, get_issue_comments

    try:
        issue = get_issue(repo_name, number)
        if issue.get("state") != "closed":
            return None
        comments = get_issue_comments(repo_name, number)
    except Exception:
        return None

    for comment in reversed(comments):
        body = (comment.get("body") or "").strip()
        # A short sign-off ("thanks!", "fixed") carries no reusable fix.
        if len(body) < 40:
            continue
        return body[:1500]
    return None


def _old_issue_body(repo_name: str, number: int) -> str:
    """The old issue's own body, as a second place to look for its fix PR.

    Separate from `_resolution_context`, which deliberately returns only a
    substantive closing comment. A `#123` reference is often in the body ("this
    is tracked in #145") where that filter would never see it, and looking there
    costs one cached call. Never raises -- an unreadable body just means one
    fewer candidate.
    """
    from mcp_server.github_client import get_issue

    try:
        return str((get_issue(repo_name, number) or {}).get("body") or "")[:4000]
    except Exception:
        return ""


def _parse(text: str) -> dict:
    """Pull the JSON object out of an LLM reply.

    Failure degrades to no resolution rather than raising: a malformed
    response must not abort the investigation, and must never be treated as
    a draft worth posting.
    """
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}

    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "reply": str(data.get("reply", "")).strip(),
        "addresses_new_issue": bool(data.get("addresses_new_issue", False)),
        "confidence": max(0.0, min(1.0, confidence)),
        "reason": str(data.get("reason", ""))[:200],
    }


@chain_step("resolver", "Looking for a known fix")
def resolver_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Attempt a grounded resolution from the repo's own resolved history.

    Three gates, all of which must pass (STRETCH_FEATURES.md 16):
      1. similarity to a closed issue >= RESOLUTION_THRESHOLD
      2. that issue has a substantive resolution to draw on
      3. the model's self-check confirms the draft addresses THIS issue

    Any failure writes `resolution: None` and the graph continues to normal
    triage. Silence is the correct output most of the time.
    """
    metadata = state.get("issue_metadata") or {}

    match = _find_resolved_match(state)
    if not match:
        return {"resolution": None}, [{
            "type": "rule", "ref": "no_similar_resolved", "score": None,
            "snippet": f"no closed issue above {RESOLUTION_THRESHOLD} similarity",
        }]

    context = _resolution_context(state["repo_name"], match["number"])
    if not context:
        return {"resolution": None}, [{
            "type": "issue", "ref": str(match["number"]), "score": match["score"],
            "snippet": f"#{match['number']} matched at {match['score']:.2f} but has no recorded fix",
        }]

    prompt = _DRAFT_PROMPT.format(
        new_title=metadata.get("title") or "",
        new_body=(metadata.get("body") or "")[:2000],
        old_number=match["number"],
        old_title=match["title"],
        resolution=context,
    )

    try:
        raw = getattr(_get_llm().invoke(prompt), "content", "") or ""
        drafted = _parse(raw)
    except Exception as exc:
        return {"resolution": None}, [{
            "type": "rule", "ref": "llm_unavailable", "score": None,
            "snippet": f"could not draft a resolution: {exc}",
        }]

    evidence = [{
        "type": "issue", "ref": str(match["number"]), "score": match["score"],
        "snippet": f"resolved issue #{match['number']}: {match['title']}",
    }]

    # Gate 3. A draft that only restates the old issue is exactly the
    # copy-paste behaviour this feature exists to avoid.
    if not drafted.get("reply") or not drafted.get("addresses_new_issue"):
        evidence.append({
            "type": "rule", "ref": "self_check_failed", "score": drafted.get("confidence"),
            "snippet": drafted.get("reason") or "draft did not address the new issue",
        })
        return {"resolution": None}, evidence

    confidence = drafted["confidence"]
    auto = auto_post_enabled() and confidence >= AUTO_POST_CONFIDENCE

    evidence.append({
        "type": "rule", "ref": "resolution_drafted", "score": confidence,
        "snippet": (
            f"{'auto-post eligible' if auto else 'held for approval'} -- "
            f"{drafted.get('reason') or 'no reason given'}"
        ),
    })

    # Show the fix, do not just cite it (see agents/triage/fix_snippet.py).
    #
    # Placed here on purpose: after the draft has passed all three gates, so a
    # reply that was never going to be sent does not spend API calls reading a
    # diff. The reply is only extended when a snippet clears every safeguard --
    # an irrelevant diff posted publicly costs more trust than no diff at all,
    # so every rejection is recorded as evidence and the link-only reply stands.
    reply = drafted["reply"]
    snippet = None
    try:
        from agents.triage.fix_snippet import extract_fix_snippet

        snippet = extract_fix_snippet(
            state["repo_name"],
            issue_text=f"{metadata.get('title') or ''}\n\n{metadata.get('body') or ''}",
            resolution_text=context,
            old_issue_body=_old_issue_body(state["repo_name"], match["number"]),
        )
    except Exception as exc:
        # Never fail the resolution over its enhancement.
        evidence.append({
            "type": "rule", "ref": "fix_snippet_error", "score": None,
            "snippet": f"could not extract a fix snippet: {exc}",
        })

    if snippet and snippet.get("markdown"):
        reply = f"{reply}\n\n{snippet['markdown']}"
        top = snippet["hunks"][0]
        evidence.append({
            "type": "pr", "ref": str(snippet["pr_number"]), "score": snippet["top_relevance"],
            "snippet": (
                f"extracted the fix from #{snippet['pr_number']} -- "
                f"{top['changed']}-line change in {top['file']} "
                f"(relevance {snippet['top_relevance']:.2f})"
            ),
        })
    elif snippet:
        evidence.append({
            "type": "pr", "ref": str(snippet["pr_number"]), "score": snippet["top_relevance"],
            "snippet": f"#{snippet['pr_number']} cited but not inlined: {snippet['rejected']}",
        })
    elif snippet is None:
        evidence.append({
            "type": "rule", "ref": "no_fix_pr", "score": None,
            "snippet": f"#{match['number']} has no linked merged pull request to quote",
        })

    return {
        "resolution": {
            "source_issue": match["number"],
            "source_title": match["title"],
            "similarity": match["score"],
            "reply": reply,
            "confidence": confidence,
            "reason": drafted.get("reason", ""),
            # decider performs the write; this node never touches GitHub.
            "auto_post": auto,
            "posted": False,
            # The spec's `code_snippets` payload, for any consumer that wants
            # the hunks rather than the rendered reply.
            "code_snippets": snippet if snippet and snippet.get("markdown") else None,
        }
    }, evidence
