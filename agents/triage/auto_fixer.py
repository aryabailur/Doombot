"""Auto-Fix PR: replay a merged fix from a resolved issue onto this one.

Two nodes, not one. AUTO_FIX.md describes two distinct entries in the
investigation chain -- "Patch applicability check" and "Draft PR opened" --
and `chain_step` emits exactly one StepRecord per node, so two visible steps
means two node functions, not one node with two evidence entries glued
together.

Nodes: patch_checker, fix_pr_opener
Reads:  decision, resolution, issue_metadata, repo_name, issue_number
Writes: auto_fix_plan, auto_fix

Runs after decider (see the tail of agents/triage_graph.py): decider is the
node that owns the triage decision and the triage comment, and there is
nothing here to replay until an action has actually been chosen.

Everything that talks to GitHub or an LLM lives in agents/triage/auto_fix.py,
imported lazily inside each node function -- the same deferred-import
discipline resolver.py uses for fix_snippet, so importing this module never
requires a GitHub token or a Groq key, and a unit test can call either node
directly with a plain dict.
"""

from __future__ import annotations

from agents.chain import chain_step
from agents.state import GraphState


@chain_step("patch_checker", "Checking whether the fix still applies")
def patch_checker_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Check whether a previously merged fix can be replayed onto this issue.

    Two gates, checked in order, each of which writes `auto_fix_plan: None`
    plus exactly one `rule` evidence entry naming the gate that stopped it:

      1. The decision must be "resolve". decider._decide (agents/triage/
         decider.py) already ranks a security escalation above a resolution
         and a resolution above closing as a duplicate. Gating on the chosen
         action here means that priority is inherited for free -- a security
         escalation can never be answered with a patch -- instead of
         re-deriving the same ordering a second time in this file.
      2. There must be a resolution with a `code_snippets` payload that names
         a source PR (agents/triage/resolver.py + fix_snippet.py). Without
         that there is no known diff to replay, only prose.

    Never raises: a broken applicability check is an enhancement failing, not
    a reason to fail an investigation that already reached a decision.
    """
    decision = state.get("decision") or {}
    if decision.get("action") != "resolve":
        return {"auto_fix_plan": None}, [{
            "type": "rule", "ref": "not_a_resolution", "score": None,
            "snippet": (
                f"decision was \"{decision.get('action', 'unknown')}\", not "
                "\"resolve\" -- nothing to replay"
            ),
        }]

    resolution = state.get("resolution") or {}
    code_snippets = resolution.get("code_snippets") or {}
    source_pr = code_snippets.get("pr_number")
    if not resolution or not code_snippets or not source_pr:
        return {"auto_fix_plan": None}, [{
            "type": "rule", "ref": "no_known_diff", "score": None,
            "snippet": "no resolution with a linked fix PR to replay",
        }]

    # Same title-blank-line-body shape resolver._find_resolved_match queries
    # Chroma with -- plan_fix compares this issue against `source_pr`'s diff,
    # so it needs the same text a human would read, not a truncated fragment.
    metadata = state.get("issue_metadata") or {}
    issue_text = f"{metadata.get('title') or ''}\n\n{metadata.get('body') or ''}"

    try:
        from agents.triage import auto_fix

        plan = auto_fix.plan_fix(state["repo_name"], source_pr, issue_text)
    except Exception as exc:
        # A failure here (network, parsing, whatever) must not sink an
        # investigation that already reached a decision -- record it and move
        # on, the same posture resolver takes toward its own LLM call.
        return {"auto_fix_plan": None}, [{
            "type": "rule", "ref": "plan_fix_error", "score": None,
            "snippet": f"could not check patch applicability: {exc}",
        }]

    if plan.get("applicable"):
        evidence = [{
            "type": "pr", "ref": str(source_pr), "score": plan.get("relevance"),
            "snippet": plan.get("reason", ""),
        }]
    else:
        evidence = [{
            "type": "rule", "ref": "patch_not_applicable", "score": None,
            "snippet": plan.get("reason", ""),
        }]

    # The plan is written either way -- an inapplicable plan's reason is what
    # the next node and the dashboard explain themselves with, not just a bool.
    return {"auto_fix_plan": plan}, evidence


@chain_step("fix_pr_opener", "Opening a draft fix PR")
def fix_pr_opener_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Open a draft PR that replays an applicable fix onto this issue.

    Off by default. Opening a pull request on someone's repository unattended
    is the most consequential write in the product -- more so than posting a
    comment -- so it requires the same explicit opt-in decider already
    enforces for DOOMBOT_AUTO_RESOLVE (see decider_node's "resolution_held"
    evidence). DOOMBOT_AUTO_FIX=1 opts in; the VS Code extension's "Doombot:
    Open Auto-Fix PR" command is the other way forward when it is not set.

    Never raises, for the same reason patch_checker never does.
    """
    plan = state.get("auto_fix_plan")
    if not plan or not plan.get("applicable"):
        # The previous step already recorded *why* it isn't applicable
        # (patch_not_applicable / not_a_resolution / no_known_diff) -- this
        # just says there is nothing to do, it does not repeat the reason.
        return {"auto_fix": None}, [{
            "type": "rule", "ref": "not_applicable", "score": None,
            "snippet": "no applicable patch -- nothing to open a PR for",
        }]

    # Inside the try, not above it. `auto_fix` reaches into `rag`, which pulls
    # in torch and chromadb; an environment where that import fails must not
    # take down an investigation that has already decided and commented.
    try:
        from agents.triage import auto_fix

        enabled = auto_fix.auto_fix_enabled()
    except Exception as exc:
        return {"auto_fix": None}, [{
            "type": "rule", "ref": "auto_fix_unavailable", "score": None,
            "snippet": f"auto-fix is not available in this environment: {exc}",
        }]

    if not enabled:
        # Build the same shape open_fix_pr would return, without calling it --
        # DEFAULT path, so this is the common case, not an edge case.
        result = {
            "status": "blocked",
            "reason": (
                "Auto-fix is off. Set DOOMBOT_AUTO_FIX=1 to let the agent open "
                "draft fix PRs on its own, or open this one on demand."
            ),
            "source_pr": plan.get("source_pr"),
            "pr_number": None,
            "pr_url": None,
            "branch": None,
            "file": plan.get("file"),
            "changed_lines": plan.get("changed_lines", 0),
            "ci": False,
            "commented": False,
        }
        return {"auto_fix": result}, [{
            "type": "rule", "ref": "auto_fix_blocked", "score": None,
            "snippet": (
                "fix drafted but not opened -- set DOOMBOT_AUTO_FIX=1, or run "
                "\"Doombot: Open Auto-Fix PR\" from the VS Code extension"
            ),
        }]

    try:
        result = auto_fix.open_fix_pr(
            state["repo_name"], state["issue_number"], plan,
            issue_title=(state.get("issue_metadata") or {}).get("title", ""),
        )
    except Exception as exc:
        return {"auto_fix": None}, [{
            "type": "rule", "ref": "open_fix_pr_error", "score": None,
            "snippet": f"could not open fix PR: {exc}",
        }]

    status = result.get("status")
    if status in ("opened", "existing"):
        # CONTRACT, read this before "cleaning up" the ref below: the VS Code
        # extension (vscode-extension/) detects a fix PR on this investigation
        # by scanning the fix_pr_opener step's evidence for a type: "pr" entry
        # and reading `ref` as the bare PR number, e.g. "302". Emit type: "pr"
        # here if and ONLY IF a draft PR genuinely exists, and never format
        # `ref` as a URL -- turning it into a link silently breaks that badge.
        verb = "opened" if status == "opened" else "found an existing"
        evidence = [{
            "type": "pr", "ref": str(result.get("pr_number")), "score": None,
            "snippet": (
                f"{verb} draft PR #{result.get('pr_number')} on branch "
                f"{result.get('branch')}"
            ),
        }]
    else:
        evidence = [{
            "type": "rule", "ref": f"auto_fix_{status}", "score": None,
            "snippet": result.get("reason") or f"auto-fix status: {status}",
        }]

    return {"auto_fix": result}, evidence
