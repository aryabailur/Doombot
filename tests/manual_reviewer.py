import asyncio
from agents.reviewer import reviewer_node

dummy_state = {
    "repo_name": "aryabailur/github-review-agent",
    "pr_number": 1,
    "pr_metadata": {},
    "diff_files": [
        {
            "name": "server.py",
            "differences": "@@ -1,5 +1,6 @@\n def transfer_money(amount, account):\n-    db.execute(f'UPDATE accounts SET balance = balance - {amount}')\n+    db.execute(f'UPDATE accounts SET balance = balance - {amount} WHERE id = {account}')\n"
        }
    ],
    "review_metadata": [],
    "test_metadata": [],
    "summary_metadata": ""
}
result=reviewer_node(dummy_state)
print(result)