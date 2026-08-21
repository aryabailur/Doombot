"""The graph runner -- where an investigation becomes visible.

Consumes LangGraph's custom stream and fans every step out to two places at
once: SQLite for durability, the WebSocket hub for the live trace. Both come
from the same `StepRecord` the `@chain_step` decorator emits, which is what
makes the dashboard's timeline and its refresh-proof replay the same data
rather than two sources that can disagree.

Kept in its own module rather than inside `routes_investigations.py` so the
routes stay thin and this can be tested without standing up FastAPI.
"""

from __future__ import annotations

import logging
import uuid

from api import ws
from memory import repo

logger = logging.getLogger(__name__)

# Escalation severity by decision action. The decider already ranked these;
# this only translates its vocabulary into the queue's.
_SEVERITY = {
    "escalate": "critical",
    "resolve": "info",
    "close_duplicate": "warning",
    "comment": "info",
}


def new_investigation_id() -> str:
    return str(uuid.uuid4())


async def run_investigation(
    investigation_id: str,
    repo_name: str,
    kind: str,
    number: int,
) -> None:
    """Run the triage graph, persisting and broadcasting each step.

    Never raises. It runs as a FastAPI background task, where an exception
    would be swallowed by the event loop and lost -- so a failure is recorded
    on the investigation row and broadcast, which is the only way the
    dashboard can show that something went wrong rather than a trace that
    simply stops.
    """
    # Imported here, not at module scope: agents pulls in torch and chromadb,
    # and the API should start fast and stay importable without them.
    from agents.triage_graph import issue_app

    repo.create_investigation(
        investigation_id=investigation_id,
        repo_name=repo_name,
        kind=kind,
        number=number,
        title=f"{repo_name}#{number}",
    )

    state = {
        "repo_name": repo_name,
        "issue_number": number,
        "investigation_id": investigation_id,
        "chain": [],
    }

    final: dict = {}
    try:
        async for mode, chunk in issue_app.astream(
            state, stream_mode=["custom", "updates"]
        ):
            if mode == "updates":
                # Accumulate the final state as the run happens, rather than
                # asking for it afterwards.
                #
                # This used to end with `final = await issue_app.ainvoke(state)`,
                # which executes the ENTIRE graph a second time -- every Groq
                # call, every GitHub read, every node. Confirmed with a counter
                # node: after astream it had run once, after ainvoke twice. The
                # writes were idempotent (the decider recognises its own comment
                # marker, auto-fix finds its own open pull request) so nothing
                # was duplicated, which is exactly why it went unnoticed -- it
                # only ever cost twice the time and twice the rate-limit budget.
                #
                # `updates` yields {node_name: patch}, which is what the node
                # returned, so merging them in order reconstructs the same state
                # ainvoke would have produced.
                for patch in (chunk or {}).values():
                    for key, value in (patch or {}).items():
                        if key == "chain":
                            # `chain` is Annotated[list, add] in GraphState, so
                            # it accumulates rather than being replaced. Every
                            # other field is last-write-wins, LangGraph's
                            # default. Overwriting here would leave `final`
                            # holding only the last node's single record and
                            # break step_ts below.
                            final.setdefault("chain", []).extend(value or [])
                        else:
                            final[key] = value
                continue

            step = chunk.get("data")
            if not step:
                continue

            # Persist only completed steps. A "running" record has no duration
            # and no evidence yet, and would be overwritten a moment later --
            # the live stream is what conveys "in progress", not the database.
            if chunk.get("type") == "step.completed":
                try:
                    repo.insert_step(step)
                except Exception:
                    # A persistence failure must not kill the run. The trace is
                    # still live; only its replay is degraded.
                    logger.exception("failed to persist step %s", step.get("step_id"))

            await ws.broadcast(chunk)

    except Exception as exc:
        logger.exception("investigation %s failed", investigation_id)
        repo.complete_investigation(
            investigation_id=investigation_id,
            decision="error",
            decision_reason=str(exc)[:500],
            confidence=0.0,
            impact_score=0.0,
        )
        await ws.broadcast({
            "type": "investigation.completed",
            "data": {
                "investigation_id": investigation_id,
                "decision": "error",
                "health_delta": 0,
            },
        })
        return

    decision = final.get("decision") or {}
    action = decision.get("action", "no_action")

    repo.complete_investigation(
        investigation_id=investigation_id,
        decision=action,
        decision_reason=decision.get("reason", ""),
        confidence=float(decision.get("confidence") or 0.0),
        impact_score=float(final.get("impact_score") or 0.0),
    )

    # Only escalations reach the queue. "no_action" is recorded on the
    # investigation but must not appear as something needing attention --
    # selective escalation (F04) is the whole point.
    if action in {"escalate", "close_duplicate", "resolve"}:
        try:
            repo.create_escalation(
                investigation_id=investigation_id,
                repo_name=repo_name,
                reason=decision.get("reason", ""),
                severity=_SEVERITY.get(action, "info"),
            )
        except Exception:
            logger.exception("failed to record escalation for %s", investigation_id)

    await ws.broadcast({
        "type": "investigation.completed",
        "data": {
            "investigation_id": investigation_id,
            "decision": action,
            "health_delta": 0,
        },
    })

    await ws.broadcast({
        "type": "activity",
        "data": {
            "ts": step_ts(final),
            "repo_name": repo_name,
            "message": f"{action.replace('_', ' ').title()} — {repo_name}#{number}",
            "severity": _SEVERITY.get(action, "info"),
        },
    })


def step_ts(final: dict) -> str:
    """Timestamp of the last step, so activity ordering matches the trace."""
    chain = final.get("chain") or []
    if chain:
        return chain[-1].get("ended_at") or chain[-1].get("started_at") or ""
    return ""
