# test_fetcher.py
import asyncio
from agents.fetcher import fetcher_node
from agents.orchestrator import GraphState

dummy_state = {
    "repo_name": "aryabailur/Stock-Market-Portfolio",
    "pr_number": 1,
    "pr_metadata": {},
    "diff_files": [],
    "review_metadata": [],
    "test_metadata": [],
    "summary_metadata": ""
}

result=asyncio.run(fetcher_node(dummy_state))
print(result)
