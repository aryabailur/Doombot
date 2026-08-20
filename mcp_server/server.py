"""MCP stdio entry point.

Both tool modules are imported for their registration side effects:
`tools` exposes GitHub to Doombot, `intelligence` exposes Doombot's analysis to
any MCP client. Importing `intelligence` is what makes F18's tools visible to a
client's tool listing -- without it they exist but are never registered.
"""

from mcp_server.tools import mcp
from mcp_server import intelligence  # noqa: F401  (registers F18 tools)

if __name__ == "__main__":
    mcp.run(transport="stdio")
