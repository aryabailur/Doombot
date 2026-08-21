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


@mcp.tool()
def auto_fix_issue_mcp(repo_name: str, issue_number: int, source_pr: int = 0) -> str:
    """Attempt to automatically fix a GitHub issue and open a pull request for it.

    This is a write action, not a lookup, and must never be called
    speculatively "just to see". It costs several GitHub requests (reading
    the issue, locating or reading a source PR, committing a candidate fix,
    opening a PR) and changes real repository state. Call it only once a
    maintainer or the triage flow has decided a fix should be attempted.

    The pull request it opens, when it opens one, is always a **draft** and
    is never merged automatically -- a human still reviews and merges it.
    When a fix cannot be applied, the result carries a `reason` string
    explaining why instead of raising.

    `source_pr` is the PR number a candidate fix should be based on. Pass 0
    (the default) when that is not known and the fix should locate one
    itself; MCP tool schemas are cleaner without an Optional parameter, so 0
    stands in for "not known" at the wire boundary.

    Returns a JSON object with at least: status ("opened", "existing",
    "not_applicable", "blocked", "no_source_pr", or "error"), reason,
    source_pr, pr_number, pr_url, branch, file, changed_lines, ci, commented.
    """
    # Imported here, not at module scope: this module is imported by the MCP
    # server at startup, agents.triage.auto_fix reaches into rag, and rag
    # pulls in torch and chromadb. A module-level import would make every
    # MCP client pay a multi-second model-stack import just to list tools.
    from agents.triage.auto_fix import auto_fix_issue
    return json.dumps(auto_fix_issue(repo_name, issue_number, source_pr or None))
