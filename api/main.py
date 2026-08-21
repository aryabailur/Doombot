"""FastAPI application entrypoint.

Mounts the routers, enables CORS for http://localhost:5173 (Vite dev
server), the VS Code webview origin, and https://github.com (the
RepoGuardian Lens content script), and on startup calls
memory.db.init_db() and mcp_server.client.startup().

Run:  uvicorn api.main:app --reload --port 8000
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from memory.db import init_db
from memory import repo as memory_repo
from mcp_server import client as mcp_client
from api import monitor
from api.ws import websocket_endpoint
from api.routes_repos import router as repos_router
from api.routes_investigations import router as investigations_router
from api.routes_feedback import router as feedback_router
from api.routes_fixlab import router as fixlab_router


def _warn_missing_credentials() -> None:
    """Log which credentials are absent, once, at startup.

    PyGithub raises a bare `AssertionError('')` when the token is empty, and by
    the time that crosses the MCP boundary and LangGraph's TaskGroup it reads as
    "unhandled errors in a TaskGroup (1 sub-exception)" -- which says nothing
    about the actual cause. Naming the missing variable here turns a
    three-layer debugging session into one line of output.

    A warning, not an exit: the health endpoint, the dashboard, and replay of
    stored investigations all work without credentials.
    """
    missing = [name for name in ("GITHUB_TOKEN", "GROQ_API_KEY") if not os.getenv(name)]
    if missing:
        logging.getLogger(__name__).warning(
            "%s empty in .env - live investigations will fail. "
            "Reads from SQLite and /api/health still work.",
            ", ".join(missing),
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _warn_missing_credentials()
    init_db()
    interrupted = memory_repo.fail_interrupted_fix_runs()
    if interrupted:
        logging.getLogger(__name__).warning(
            "Marked %d interrupted Fix Lab run(s) as failed.", interrupted
        )
    await mcp_client.startup()
    # Autonomous monitoring (F01, the compulsory PS-04 feature). No-ops unless
    # DOOMBOT_MONITOR_REPOS names a repository -- it starts investigations on
    # its own, so it must not be on by default.
    await monitor.start()
    yield
    await monitor.stop()
    await mcp_client.shutdown()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "vscode-webview://*",
        # RepoGuardian Lens's content script runs on GitHub, so panel-side
        # requests carry https://github.com as the origin.
        "https://github.com",
    ],
    # The Lens's MV3 service worker is a different origin from its content
    # script: fetches from the worker carry chrome-extension://<id>, where the
    # id is assigned per install and cannot be enumerated ahead of time.
    # Without this the worker's calls have no allow-origin header and Chrome
    # reports them as a network failure, which the panel shows as "backend
    # unreachable" even though the API answered 200.
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(repos_router)
app.include_router(investigations_router)
app.include_router(feedback_router)
app.include_router(fixlab_router)

app.add_api_websocket_route("/ws", websocket_endpoint)
