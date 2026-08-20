"""Semantic duplicate detection over the repo's indexed issues.

Node: duplicate_detector
Reads:  repo_name, issue_number, issue_metadata
Writes: duplicates

Uses rag.retriever.find_duplicates(). Thresholds per finalFeatures.md
section 6: >0.85 duplicate, 0.65-0.85 related.

CRITICAL: must exclude the issue's own number from results, or every
issue is its own perfect duplicate.
"""
from agents.chain import chain_step
from rag.retriever import find_duplicates


@chain_step(name="duplicate_detector", title="Checking for duplicate issues")
def duplicate_detector(state):
    repo_name = state["repo_name"]
    issue_number = state["issue_number"]
    issue_metadata = state["issue_metadata"]

    title = issue_metadata.get("title", "")
    body = issue_metadata.get("body", "") or ""
    issue_text = f"{title}\n\n{body}"

    result = find_duplicates(issue_text, repo_name, exclude_number=issue_number)
    matches = result["duplicates"] + result["related"]

    patch = {"duplicates": matches}
    evidence = [
        {
            "type": "duplicate",
            "ref": str(entry["number"]),
            "score": entry["score"],
            "snippet": entry["title"],
        }
        for entry in matches
    ]
    return patch, evidence, ["semantic_search"]
