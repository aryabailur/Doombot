from langchain_groq import ChatGroq
from dotenv import load_dotenv
from agents.state import GraphState
from mcp import (StdioServerParameters,stdio_client)
from mcp import ClientSession
from langchain_core.messages import (SystemMessage,HumanMessage)
from mcp_server.tool_names import POST_COMMENT
import asyncio

load_dotenv()
llm = ChatGroq(model="openai/gpt-oss-120b")

def summarizer_node(state:GraphState):
    review_metadata=state["review_metadata"]
    test_metadata=state["test_metadata"]
    summary = llm.invoke([
    SystemMessage(
        content="""You are a senior code reviewer writing a final PR review comment for GitHub.
        
Your job is to compile the findings and test suggestions into a clean, structured review comment.

Format your response exactly like this:
## Code Review Summary

### Issues Found
List each issue with severity and description

### Suggested Tests
List the suggested test cases

### Overall Assessment
One paragraph summary of the PR quality and what needs to be fixed before merging."""
    ),
    HumanMessage(
        content=f"Compile this into a final GitHub PR review comment:\n\nFindings:\n{review_metadata}\n\nTest Suggestions:\n{test_metadata}"
    )
])
    async def mcp_call():
        system_params=StdioServerParameters(
            command="python",
            args=["-m", "mcp_server.server"]
        )
        async with stdio_client(system_params) as(
            read_stream,
            write_stream,
        ):
            async with ClientSession(
                read_stream,
                write_stream
            ) as session:
                await session.initialize()
                result= await session.call_tool(
                    POST_COMMENT,
                    {
                        "repo_name":state["repo_name"],
                        "pr_number":state["pr_number"],
                        "comment":summary.content
                    }
                )
    asyncio.run(mcp_call())
    return {"summary_metadata":summary.content}




