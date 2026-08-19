"""Investigation endpoints and the graph runner.

    POST /api/investigations        -> {investigation_id}, runs graph in background
    GET  /api/investigations        -> list
    GET  /api/investigations/{id}   -> detail + steps (replayed from SQLite)
    GET  /api/escalations           -> escalation queue

The runner consumes the LangGraph custom stream and fans each step out to
both SQLite and the WebSocket hub:

    async for mode, chunk in issue_app.astream(init, stream_mode=["custom", "updates"]):
        if mode == "custom":
            repo.insert_step(chunk["data"])
            await ws.broadcast(chunk)
"""
