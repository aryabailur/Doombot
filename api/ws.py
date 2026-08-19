"""WebSocket hub.

A single /ws endpoint backed by a module-level set[WebSocket]. No rooms,
no auth: broadcast every event and let the client filter by
investigation_id. Correct at demo scale.

Event types:
    step.started              -> StepRecord
    step.completed            -> StepRecord
    investigation.completed   -> {investigation_id, decision, health_delta}
    activity                  -> {ts, repo_name, message, severity}

To implement:
    async def broadcast(event: dict) -> None
    async def websocket_endpoint(ws: WebSocket) -> None
"""
