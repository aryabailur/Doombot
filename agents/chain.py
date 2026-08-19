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

To implement:
    chain_step(name: str, title: str) -> Callable
    _next_seq(state) -> int
    _split(result) -> tuple[dict, list[dict]]
"""
