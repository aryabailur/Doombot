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
ADD_LABELS = "add_labels_mcp"
