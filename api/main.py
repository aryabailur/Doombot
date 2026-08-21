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
from mcp_server import client as mcp_client
from api import monitor
from api.ws import websocket_endpoint
from api.routes_repos import router as repos_router
from api.routes_investigations import router as investigations_router
from api.routes_feedback import router as feedback_router


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


async def _warm_embedding_model() -> None:
    """Load the sentence-transformer once, in the background, at startup.

    The model is a module-level singleton in `rag/embedder.py`, so whichever
    request touches it first pays the whole load -- measured at 11.5s. That
    request is usually the first thing a person does after starting the API,
    which is exactly the worst moment to spend eleven seconds: an auto-fix or a
    search that normally takes eleven feels like a minute.

    Runs in a thread so it never blocks the event loop, and swallows its own
    failure: a machine that cannot load the model has bigger problems than a
    cold cache, and refusing to start the API over it would take down every
    endpoint that does not need embeddings at all.
    """
    import asyncio

    def _load() -> None:
        from rag.embedder import _get_model

        _get_model()

    # "uvicorn.error", not __name__: uvicorn installs its own logging config
    # and does not enable arbitrary module loggers, so an INFO line logged under
    # api.main never reaches the console. This line exists to be *seen* -- it is
    # how an operator knows the API is ready for a request that embeds anything.
    log = logging.getLogger("uvicorn.error")
    try:
        await asyncio.to_thread(_load)
        log.info("embedding model warmed -- searches and auto-fix are now fast")
    except Exception:
        log.warning(
            "could not warm the embedding model; the first search will be slow",
            exc_info=True,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _warn_missing_credentials()
    init_db()
    await mcp_client.startup()
    # Fire and forget: the API is ready to serve immediately, and the model
    # finishes loading behind the first few requests rather than inside one.
    import asyncio

    warm = asyncio.create_task(_warm_embedding_model())
    # Autonomous monitoring (F01, the compulsory PS-04 feature). No-ops unless
    # DOOMBOT_MONITOR_REPOS names a repository -- it starts investigations on
    # its own, so it must not be on by default.
    await monitor.start()
    yield
    warm.cancel()
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

app.add_api_websocket_route("/ws", websocket_endpoint)
