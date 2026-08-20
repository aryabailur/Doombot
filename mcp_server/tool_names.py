"""Canonical MCP tool names.

Import these constants instead of writing string literals. Tool-name drift
between the registration in `tools.py` and the call sites in `agents/`
caused two of the eight bugs found in the prototype.

Values MUST match the @mcp.tool() function names in mcp_server/tools.py.
"""

GET_PR_FILES = "get_pullRequest_files"
GET_FILE_CONTENT = "get_file_content_mcp"
GET_PR_DETAILS = "get_pr_details_mcp"
POST_COMMENT = "post_review_comment_mcp"

# Registered during the triage build-out.
GET_ISSUE = "get_issue_mcp"
GET_ISSUES = "get_issues_mcp"
POST_ISSUE_COMMENT = "post_issue_comment_mcp"
GET_ISSUE_COMMENTS = "get_issue_comments_mcp"
ADD_LABELS = "add_labels_mcp"

# --- F18: the intelligence layer (mcp_server/intelligence.py) ---------------
#
# These expose Doombot's own analysis to external MCP clients, rather than
# exposing GitHub to Doombot. All read-only: none of them writes to GitHub.
SEARCH_ISSUES = "search_issues_mcp"
FIND_DUPLICATES = "find_duplicates_mcp"
GET_ESCALATIONS = "get_escalations_mcp"
GET_HEALTH_SCORE = "get_health_score_mcp"
GET_INVESTIGATION = "get_investigation_mcp"
LIST_INVESTIGATIONS = "list_investigations_mcp"
GET_ISSUE_GRAPH = "get_issue_graph_mcp"

#: Every intelligence tool, for tests that assert the surface is registered.
INTELLIGENCE_TOOLS = (
    SEARCH_ISSUES,
    FIND_DUPLICATES,
    GET_ESCALATIONS,
    GET_HEALTH_SCORE,
    GET_INVESTIGATION,
    LIST_INVESTIGATIONS,
    GET_ISSUE_GRAPH,
)
