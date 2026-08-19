"""Semantic duplicate detection over the repo's indexed issues.

Node: duplicate_detector
Reads:  repo_name, issue_number, issue_metadata
Writes: duplicates

Thresholds per finalFeatures.md section 6: >0.85 duplicate,
0.65-0.85 related, below 0.65 dropped.
"""

from agents.chain import chain_step
from agents.state import GraphState
from rag.retriever import find_duplicates


@chain_step("duplicate_detector", "Searching for duplicate issues")
def duplicate_detector_node(state: GraphState) -> tuple[dict, list[dict]]:
    """Search past issues for semantic near-matches.

    The query text is built exactly the way index_issues builds page_content
    -- f"{title}\\n\\n{body}" -- so the query and the indexed documents are
    comparable. Querying with a differently-shaped string would compare a
    bare title against title+body documents and depress every score.

    CRITICAL: exclude_number is passed through. The issue under triage is
    itself in the {repo}-issues collection and returns as its own nearest
    neighbour at score ~1.0 -- verified. Without the exclusion every issue
    is a duplicate of itself and the feature is worthless.
    """
    repo_name = state["repo_name"]
    issue_number = state["issue_number"]
    metadata = state.get("issue_metadata") or {}

    title = metadata.get("title") or ""
    body = metadata.get("body") or ""
    query = f"{title}\n\n{body}"

    result = find_duplicates(query, repo_name, exclude_number=issue_number)
    matches = result["duplicates"] + result["related"]

    evidence = [
        {
            "type": "issue",
            "ref": str(match["number"]),
            "score": match["score"],
            "snippet": f"{match['relation']}: {match['title']}",
        }
        for match in matches
    ]
    return {"duplicates": matches}, evidence
