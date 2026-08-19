"""FastAPI application entrypoint.

Mounts the routers, enables CORS for http://localhost:5173 (Vite dev
server), and on startup calls memory.db.init_db() and
mcp_server.client.startup().

Run:  uvicorn api.main:app --reload --port 8000
"""
