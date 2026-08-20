"""Chain-step decorator -- the hero feature.

Wraps every LangGraph node so it emits a structured StepRecord to the
LangGraph custom stream (via `langgraph.config.get_stream_writer`) AND
appends it to `state["chain"]`.

One code path yields three things: live WebSocket streaming, SQLite
persistence, and refresh-proof replay.

Contract for node authors:
    A decorated node returns either `patch` or `(patch, evidence)`.
    Nodes NEVER touch the database or the WebSocket hub, and never import
    `memory/` or `api/` -- this decorator handles all of it.
"""

import time
import uuid
from datetime import datetime, timezone
from functools import wraps

from langgraph.config import get_stream_writer

from agents.state import GraphState


def _utcnow() -> str:
    """ISO-8601 UTC timestamp. One format everywhere, so Stream A can parse it."""
    return datetime.now(timezone.utc).isoformat()


def _next_seq(state: GraphState) -> int:
    """Next 0-based sequence number for this run.

    Derived from the length of the append-only `chain` log, which is the
    authoritative record of how many steps have completed so far.
    """
    return len(state.get("chain", []))


def _split(result) -> tuple[dict, list[dict]]:
    """Normalize a node's return value into `(patch, evidence)`.

    Accepts either `patch` or `(patch, evidence)`; evidence defaults to [].
    """
    if isinstance(result, tuple):
        if len(result) != 2:
            raise ValueError(
                f"node returned a {len(result)}-tuple; expected (patch, evidence)"
            )
        patch, evidence = result
    else:
        patch, evidence = result, []

    if patch is None:
        patch = {}
    if not isinstance(patch, dict):
        raise TypeError(f"node patch must be a dict, got {type(patch).__name__}")
    if not isinstance(evidence, list):
        raise TypeError(
            f"node evidence must be a list, got {type(evidence).__name__}"
        )
    return patch, evidence


def _base_record(state: GraphState, seq: int, name: str, title: str) -> dict:
    """Build the common StepRecord fields shared by every status."""
    return {
        "step_id": str(uuid.uuid4()),
        # "" for the PR graph, which has no investigation concept yet.
        "investigation_id": state.get("investigation_id", ""),
        "seq": seq,
        "name": name,
        "title": title,
        "status": "running",
        "input_summary": _input_summary(state),
        "output_summary": "",
        "evidence": [],
        "duration_ms": 0,
        "started_at": _utcnow(),
        "ended_at": None,
    }


def _input_summary(state: GraphState) -> str:
    """Short human string describing what the node was given.

    Kept deliberately terse -- this renders in a dashboard timeline, not a log
    file, and must never leak issue/PR bodies or credentials.
    """
    repo = state.get("repo_name", "")
    if state.get("issue_number") is not None:
        return f"{repo} issue #{state['issue_number']}".strip()
    if state.get("pr_number") is not None:
        return f"{repo} PR #{state['pr_number']}".strip()
    return repo


def _summarize_patch(patch: dict) -> str:
    """Short human string describing what the node produced.

    Reports shape, not content: keys and collection sizes. Node bodies and
    LLM prose never reach the dashboard through this path.
    """
    if not patch:
        return "no changes"
    parts = []
    for key, value in patch.items():
        if isinstance(value, (list, tuple, dict)):
            parts.append(f"{key}={len(value)}")
        elif isinstance(value, (int, float, bool)):
            parts.append(f"{key}={value}")
        else:
            parts.append(key)
    return ", ".join(parts)


def chain_step(name: str, title: str):
    """Wrap a LangGraph node so it emits a StepRecord and appends it to state["chain"].

    Args:
        name: stable machine identifier for this node, e.g. "issue_fetcher".
              Matches the LangGraph node name registered in the graph.
        title: human-readable label shown in the dashboard's live chain view,
               e.g. "Fetching issue".

    The wrapped node's signature is unchanged: `def node(state: GraphState) -> dict`.
    The decorator does not change what the node receives; it changes what
    happens to what the node returns.
    """

    def decorator(fn):
        @wraps(fn)
        def wrapped(state: GraphState) -> dict:
            writer = _safe_writer()
            seq = _next_seq(state)
            rec = _base_record(state, seq, name, title)

            writer({"type": "step.started", "step": rec})
            start = time.perf_counter()

            try:
                patch, evidence = _split(fn(state))
            except Exception as exc:
                rec = {
                    **rec,
                    "status": "error",
                    "output_summary": str(exc),
                    "duration_ms": int((time.perf_counter() - start) * 1000),
                    "ended_at": _utcnow(),
                }
                writer({"type": "step.completed", "step": rec})
                # Observe and report, then let LangGraph's run-level handling
                # take over. Never swallow.
                raise

            rec = {
                **rec,
                "status": "done",
                "output_summary": _summarize_patch(patch),
                "evidence": evidence,
                "duration_ms": int((time.perf_counter() - start) * 1000),
                "ended_at": _utcnow(),
            }
            writer({"type": "step.completed", "step": rec})

            # Return only the ONE new record. The `add` reducer on
            # state["chain"] accumulates across nodes -- returning
            # state["chain"] + [rec] here would double-append.
            return {**patch, "chain": [rec]}

        return wrapped

    return decorator


def _safe_writer():
    """Return the LangGraph stream writer, or a no-op outside a graph run.

    `get_stream_writer()` raises when called outside a LangGraph execution
    context. Nodes are unit-tested by calling them directly, so degrade to a
    no-op rather than forcing every test to spin up a graph.
    """
    try:
        writer = get_stream_writer()
    except Exception:
        return lambda _event: None
    return writer if writer is not None else (lambda _event: None)
