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

from fastapi import WebSocket, WebSocketDisconnect

# Module-level hub: every connected client, no rooms, no auth.
_hub: set[WebSocket] = set()


async def broadcast(event: dict) -> None:
    """Send `event` (already an envelope dict) to every connected client.
    Drop dead sockets silently; never let one broken client take down the loop."""
    dead: set[WebSocket] = set()
    for ws in list(_hub):
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    _hub.difference_update(dead)


async def websocket_endpoint(ws: WebSocket) -> None:
    """Accept, register in the hub set, then loop reading (and discarding)
    client messages until disconnect, at which point deregister."""
    await ws.accept()
    _hub.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _hub.discard(ws)
