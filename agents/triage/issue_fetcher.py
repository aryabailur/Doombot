"""Fetch a single GitHub issue via the shared MCP client.

Node: issue_fetcher
Reads:  repo_name, issue_number
Writes: issue_metadata
"""
import json

from agents.chain import chain_step
from mcp_server.client import call_tool_sync
from mcp_server.tool_names import GET_ISSUE


@chain_step(name="issue_fetcher", title="Fetch issue details")
def issue_fetcher(state):
    repo_name = state["repo_name"]
    issue_number = state["issue_number"]

    raw = call_tool_sync(GET_ISSUE, {"repo_name": repo_name, "issue_number": issue_number})
    issue_metadata = json.loads(raw)

    patch = {"issue_metadata": issue_metadata}
    evidence = [
        {
            "type": "issue",
            "ref": str(issue_number),
            "score": 1.0,
            "snippet": issue_metadata.get("title", ""),
        }
    ]
    return patch, evidence, [GET_ISSUE]
