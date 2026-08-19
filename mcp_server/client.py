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

To implement:
    async def startup() -> None
    async def shutdown() -> None
    async def call(tool_name: str, args: dict) -> str
    def call_tool_sync(tool_name: str, args: dict) -> str
        # for the sync LangChain @tool functions in agents/reviewer.py
"""
