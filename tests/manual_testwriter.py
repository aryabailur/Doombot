from agents.test_writer import test_writer_node
dummy_state = {
    "repo_name": "aryabailur/github-review-agent",
    "pr_number": 1,
    "pr_metadata": {},
    "diff_files": [],
    "review_metadata": '{"file": "server.py", "severity": "critical", "category": "security", "finding": "SQL injection vulnerability due to the use of f-strings to construct the SQL query."}',
    "test_metadata": [],
    "summary_metadata": ""
}

result=test_writer_node(dummy_state)
print(result)