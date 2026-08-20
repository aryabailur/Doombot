"""FastAPI application entrypoint.

Mounts the routers, enables CORS for http://localhost:5173 (Vite dev
server) and the VS Code webview origin, and on startup calls
memory.db.init_db() and mcp_server.client.startup().

Run:  uvicorn api.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from memory.db import init_db
from memory import repo
from mcp_server import client as mcp_client
from api.ws import websocket_endpoint
from api.routes_repos import router as repos_router
from api.routes_investigations import router as investigations_router
from api.routes_feedback import router as feedback_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    repo.reconcile_orphaned_investigations()
    await mcp_client.startup()
    yield
    await mcp_client.shutdown()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "vscode-webview://*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(repos_router)
app.include_router(investigations_router)
app.include_router(feedback_router)

app.add_api_websocket_route("/ws", websocket_endpoint)
