from mcp.server.fastmcp import FastMCP
from mcp_server.github_client import get_pr_files
from mcp_server.github_client import get_file_content
from mcp_server.github_client import get_pr_details
from mcp_server.github_client import post_review_comment
import json

mcp=FastMCP("Github reviewer")

@mcp.tool()
def get_pullRequest_files(repo_name:str,pr_number:int)->str:
    """This function gets the pull request files from the given repository name and pr number"""
    return json.dumps(get_pr_files(repo_name,pr_number))

@mcp.tool()
def get_file_content_mcp(repo_name:str,file_path:str)->str:
    """This function gets the contents of each pull request file"""
    return json.dumps(get_file_content(repo_name,file_path))

@mcp.tool()
def get_pr_details_mcp(repo_name:str,pr_number:int)->str:
    """This function gets the details of the pull request based on repository name and pull request number"""
    return json.dumps(get_pr_details(repo_name,pr_number))

@mcp.tool()
def post_review_comment_mcp(repo_name:str,pr_number:int,comment:str)->str:
    """This function posts a issue comment on the pull request file """
    return json.dumps(post_review_comment(repo_name,pr_number,comment))
