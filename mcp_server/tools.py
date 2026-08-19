from mcp.server.fastmcp import FastMCP
from mcp_server.github_client import (
    get_pr_files,
    get_file_content,
    get_pr_details,
    post_review_comment,
    get_issue,
    get_issues,
    post_issue_comment,
    add_labels,
    get_issue_comments,
)
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
    """Fetch a single GitHub issue by number and return its normalized
    details (title, body, state, author, labels, reactions, comments,
    participants, timestamps). Use this when you need full detail on one
    known issue, e.g. before triaging or commenting on it."""
    return json.dumps(get_issue(repo_name,issue_number))

@mcp.tool()
def get_issues_mcp(repo_name:str,state:str="open",limit:int=100)->str:
    """List issues (not pull requests) for a repository, filtered by state
    ('open', 'closed', or 'all'), capped at `limit` results. Use this for
    bulk indexing or scanning a repo's issue backlog, not for a single
    known issue (use get_issue_mcp for that, it's cheaper and more precise)."""
    return json.dumps(get_issues(repo_name,state,limit))

@mcp.tool()
def post_issue_comment_mcp(repo_name:str,issue_number:int,comment:str)->str:
    """Post a comment on a GitHub issue and return the created comment's
    body. Use this to reply to or triage an issue."""
    return json.dumps(post_issue_comment(repo_name,issue_number,comment))

@mcp.tool()
def add_labels_mcp(repo_name:str,issue_number:int,labels:list[str])->str:
    """Add one or more labels to a GitHub issue without removing any
    existing labels. Returns the issue's full label list after the add.
    Use this to tag/categorize an issue during triage."""
    return json.dumps(add_labels(repo_name,issue_number,labels))


@mcp.tool()
def get_issue_comments_mcp(repo_name: str, issue_number: int) -> str:
    """Get all comments on an issue, as a JSON list of {author, body}."""
    return json.dumps(get_issue_comments(repo_name, issue_number))
