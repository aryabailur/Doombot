"""Chain-step decorator — the hero feature.

Wraps every LangGraph node so it emits a structured StepRecord to the
LangGraph custom stream (via `langgraph.config.get_stream_writer`) AND
appends it to `state["chain"]`.

One code path yields three things: live WebSocket streaming, SQLite
persistence, and refresh-proof replay.

Contract for node authors (Person B):
    A decorated node returns either `patch` or `(patch, evidence)`.
    Nodes NEVER touch the database or the WebSocket hub — this decorator
    handles all of it.
"""
import functools
import time
import uuid
from datetime import datetime, timezone

from langgraph.config import get_stream_writer


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_seq(state: dict) -> int:
    return len(state.get("chain", [])) + 1


def _split(result):
    if isinstance(result, tuple):
        if len(result) == 3:
            patch, evidence, tool_calls = result
            return patch, evidence, tool_calls
        patch, evidence = result
        return patch, evidence, []
    return result, [], []


def chain_step(name: str, title: str):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(state):
            writer = get_stream_writer()
            seq = _next_seq(state)
            started_at = _now()
            rec = {
                "step_id": str(uuid.uuid4()),
                "investigation_id": state.get("investigation_id", ""),
                "seq": seq,
                "name": name,
                "title": title,
                "status": "running",
                "input_summary": "",
                "output_summary": "",
                "evidence": [],
                "duration_ms": 0,
                "started_at": started_at,
                "ended_at": None,
                "tool_calls": [],
            }
            writer({"type": "step.started", "data": dict(rec)})
            t0 = time.perf_counter()
            try:
                patch, evidence, tool_calls = _split(fn(state))
                ended_at = _now()
                rec.update(
                    {
                        "status": "done",
                        "output_summary": str(patch),
                        "evidence": evidence,
                        "duration_ms": int((time.perf_counter() - t0) * 1000),
                        "ended_at": ended_at,
                        "tool_calls": tool_calls,
                    }
                )
                writer({"type": "step.completed", "data": dict(rec)})
                return {**patch, "chain": [rec]}
            except Exception as e:
                ended_at = _now()
                rec.update(
                    {
                        "status": "error",
                        "output_summary": str(e),
                        "duration_ms": int((time.perf_counter() - t0) * 1000),
                        "ended_at": ended_at,
                    }
                )
                writer({"type": "step.completed", "data": dict(rec)})
                raise

        return wrapper

    return deco
