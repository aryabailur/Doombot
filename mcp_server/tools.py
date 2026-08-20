from mcp.server.fastmcp import FastMCP
from mcp_server.github_client import get_pr_files
from mcp_server.github_client import get_file_content
from mcp_server.github_client import get_pr_details
from mcp_server.github_client import post_review_comment
from mcp_server.github_client import get_issue
from mcp_server.github_client import get_issues
from mcp_server.github_client import post_issue_comment
from mcp_server.github_client import add_labels
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

@mcp.tool()
def get_issue_mcp(repo_name:str,issue_number:int)->str:
    """This function gets a single issue's details from the given repository"""
    return json.dumps(get_issue(repo_name,issue_number))

@mcp.tool()
def get_issues_mcp(repo_name:str,state:str="open",limit:int=30)->str:
    """This function lists issues for a repository, filtered by state and capped at limit"""
    return json.dumps(get_issues(repo_name,state,limit))

@mcp.tool()
def post_issue_comment_mcp(repo_name:str,issue_number:int,comment:str)->str:
    """This function posts a comment on a GitHub issue"""
    return json.dumps(post_issue_comment(repo_name,issue_number,comment))

@mcp.tool()
def add_labels_mcp(repo_name:str,issue_number:int,labels:list[str])->str:
    """This function adds labels to a GitHub issue and returns the full label list"""
    return json.dumps(add_labels(repo_name,issue_number,labels))
