from langchain.tools import tool
import asyncio
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client
from langgraph.prebuilt import create_react_agent
from agents.state import GraphState
from dotenv import load_dotenv
from rag.retriever import retrieve
from mcp_server.tool_names import GET_FILE_CONTENT
load_dotenv()
from langchain_groq import ChatGroq
llm = ChatGroq(model="llama-3.3-70b-versatile")

@tool
def get_full_file(repo_name:str,file_path:str)->str:
    """Gets the full content of a file from the repository for deeper context during review"""
    async def call_tool():
    
      server_params=StdioServerParameters(
        command="python",
        args=["-m", "mcp_server.server"]
      )
      async with stdio_client(server_params) as(
        read_stream,
        write_stream,
      ):
        async with ClientSession(
            read_stream,
            write_stream
         ) as session:
             await session.initialize()
             result=await session.call_tool(
                GET_FILE_CONTENT,
                {
                    "repo_name":repo_name,
                    "file_path":file_path
                }

            )
             return result.content[0].text
    return asyncio.run(call_tool())

        

def reviewer_node(state:GraphState):
   @tool
   def retrieve_similar_code(query: str) -> str:
       """Retrieves similar code chunks from the codebase using vector similarity search"""
       repo_name=state["repo_name"]
       result=retrieve(query,repo_name)
       return str([doc.page_content for doc in result])
   tool_list=[get_full_file,retrieve_similar_code]

   reviewer_agent=create_react_agent(
   model=llm,
   tools=tool_list,
   prompt="""You are an expert code reviewer. You will be given a list of file changes from a Pull Request.
Your job is to analyze each changed file and identify:

Bugs and logical errors
Security vulnerabilities (SQL injection, hardcoded secrets, unvalidated inputs)
Performance issues
Syntax errors

For each issue found, return a structured finding in this exact format:
{"file": "filename", "severity": "critical|major|minor", "category": "security|logic|performance|style", "finding": "description of the issue"}
You have access to two tools:

get_full_file — use this when you need full file context beyond the diff
retrieve_similar_code — use this when you need to understand patterns in the codebase

Stop when you have reviewed all changed files and have no more findings to report."""
)
       


   dif_files=state["diff_files"]
   result=reviewer_agent.invoke(
      {
         "messages":[
            {
               "role":"user",
               "content":f"review this diff {dif_files}"

         }
         ]
      }
   )
   return {"review_metadata":[result["messages"][-1].content]}
   