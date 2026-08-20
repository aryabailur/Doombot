"""Shared MCP client — one session for the whole process.

Replaces the prototype's per-node subprocess spawning (three `python
mcp_server/server.py` spawns per run, each re-importing torch and
chromadb).

Two modes behind one interface, selected by the USE_MCP_SUBPROCESS env var:
  0 (default) - dispatch directly to mcp_server.github_client functions.
                Zero subprocess risk. server.py stays alive as the
                demoable MCP surface (verifiable with MCP Inspector).
  1           - real stdio session, spawned as `python -m mcp_server.server`
                so repo root lands on sys.path without any sys.path hacks.
"""
import asyncio
import json
import os
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from mcp_server import github_client

# Maps MCP tool-name constants (mcp_server/tool_names.py) to the matching
# mcp_server.github_client function, for mode-0 direct dispatch.
_TOOL_TO_FUNC = {
    "get_pullRequest_files": "get_pr_files",
    "get_file_content_mcp": "get_file_content",
    "get_pr_details_mcp": "get_pr_details",
    "post_review_comment_mcp": "post_review_comment",
    "get_issue_mcp": "get_issue",
    "get_issues_mcp": "get_issues",
    "post_issue_comment_mcp": "post_issue_comment",
    "add_labels_mcp": "add_labels",
    # Added after this map was written: the decider needs it to detect its own
    # prior comment and stay idempotent. Direct-dispatch mode fails on any tool
    # missing here, so this map must track tool_names.py exactly.
    "get_issue_comments_mcp": "get_issue_comments",
}

_exit_stack: AsyncExitStack | None = None
_session: ClientSession | None = None
_loop: asyncio.AbstractEventLoop | None = None


def _use_subprocess() -> bool:
    return os.getenv("USE_MCP_SUBPROCESS", "0") == "1"


async def startup() -> None:
    """Mode 0: no-op. Mode 1: spawn `python -m mcp_server.server`, open the
    stdio MCP session, keep it alive for the process lifetime."""
    global _exit_stack, _session, _loop
    _loop = asyncio.get_running_loop()
    if not _use_subprocess():
        return
    if _session is not None:
        return
    _exit_stack = AsyncExitStack()
    server_params = StdioServerParameters(
        command="python",
        args=["-m", "mcp_server.server"],
    )
    read_stream, write_stream = await _exit_stack.enter_async_context(
        stdio_client(server_params)
    )
    _session = await _exit_stack.enter_async_context(
        ClientSession(read_stream, write_stream)
    )
    await _session.initialize()


async def shutdown() -> None:
    """Mode 0: no-op. Mode 1: close the session, terminate the subprocess."""
    global _exit_stack, _session
    if _exit_stack is not None:
        await _exit_stack.aclose()
    _exit_stack = None
    _session = None


async def call(tool_name: str, args: dict) -> str:
    """Dispatch to `tool_name` (always a constant from tool_names.py) with
    `args`, return the tool's string result. Mode 0: look up and
    await/run the matching mcp_server.github_client function directly.
    Mode 1: send an MCP tool-call request over the open stdio session."""
    if _use_subprocess():
        if _session is None:
            raise RuntimeError("mcp_server.client: call() before startup()")
        result = await _session.call_tool(tool_name, args)
        return result.content[0].text

    func_name = _TOOL_TO_FUNC.get(tool_name)
    if func_name is None:
        raise ValueError(f"mcp_server.client: unknown tool name {tool_name!r}")
    func = getattr(github_client, func_name)
    output = await asyncio.to_thread(func, **args)
    return json.dumps(output)


def call_tool_sync(tool_name: str, args: dict) -> str:
    """Sync wrapper around `call()`, for the sync LangChain @tool functions
    in agents/reviewer.py (LangChain tools are sync callables; the graph
    itself is async)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(call(tool_name, args))
    else:
        if _loop is None:
            raise RuntimeError(
                "mcp_server.client: call_tool_sync() from within a running "
                "loop requires startup() to have run first"
            )
        future = asyncio.run_coroutine_threadsafe(call(tool_name, args), _loop)
        return future.result()
