"""Fetch a single GitHub issue via MCP.

Node: issue_fetcher
Reads:  repo_name, issue_number
Writes: issue_metadata

Entry point of the triage graph -- no upstream node populates
issue_metadata for it.
"""

import asyncio
import json

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from agents.chain import chain_step
from agents.state import GraphState
from mcp_server.tool_names import GET_ISSUE

# `-m mcp_server.server`, not `mcp_server/server.py`. The -m form puts the
# repo root on sys.path, so the server's absolute imports resolve. Running it
# as a script makes cwd the only path entry and the imports fail.
_SERVER_PARAMS = StdioServerParameters(
    command="python",
    args=["-m", "mcp_server.server"],
)


async def _fetch_issue(repo_name: str, issue_number: int) -> dict:
    """Open a stdio MCP session and call the GET_ISSUE tool."""
    async with stdio_client(_SERVER_PARAMS) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.call_tool(
                GET_ISSUE,
                {"repo_name": repo_name, "issue_number": issue_number},
            )
            return json.loads(result.content[0].text)


@chain_step("issue_fetcher", "Fetching issue")
def issue_fetcher_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Fetch the issue under triage and seed issue_metadata.

    Cites the issue itself as evidence so the trace's first step already
    links back to the source the maintainer can open.
    """
    repo_name = state["repo_name"]
    issue_number = state["issue_number"]

    metadata = asyncio.run(_fetch_issue(repo_name, issue_number))

    evidence = [
        {
            "type": "issue",
            "ref": str(issue_number),
            "score": None,
            "snippet": metadata.get("title", ""),
        }
    ]
    return {"issue_metadata": metadata}, evidence
