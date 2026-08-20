from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client
from agents.state import GraphState
from mcp_server.tool_names import GET_PR_DETAILS, GET_PR_FILES
import json
import asyncio
import sys
def fetcher_node(state:GraphState):
    server_params=StdioServerParameters(
    command=sys.executable,
    args=["-m", "mcp_server.server"]
     )
    async def fetch():
       async with stdio_client(server_params) as (
    read_stream,
    write_stream,
    ):
        async with ClientSession(
          read_stream,
          write_stream
        ) as session:
           await session.initialize()
           result1=await session.call_tool(
               GET_PR_DETAILS,
               {
                   "repo_name":state["repo_name"],
                   "pr_number":state["pr_number"]
               }
           )
           result2=await session.call_tool(
               GET_PR_FILES,
               {
                "repo_name":state["repo_name"],
                "pr_number":state["pr_number"]   
               }
           )
           return {
               "pr_metadata": json.loads(result1.content[0].text) ,
               "diff_files":json.loads(result2.content[0].text)
           }
    return asyncio.run(fetch())
       
       
    

