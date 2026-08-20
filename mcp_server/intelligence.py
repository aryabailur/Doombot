"""F18 — the MCP intelligence layer.

`tools.py` exposes GitHub *to Doombot*: every tool there is a passthrough
(`get_issue_mcp`, `post_issue_comment_mcp`, `add_labels_mcp`). This module is
the other direction — it exposes Doombot's own analysis to any MCP client, so
an external assistant can ask about a repository and get grounded answers
instead of guesses.

Nothing here computes anything new. Every tool is a second interface onto a
function that already backs an HTTP endpoint: `rag/retriever.py`,
`rag/graph.py`, `api/health.py`, `memory/repo.py`. If a tool needs logic that
does not exist yet, that is a different feature.

**Read-only, without exception.** No tool in this module posts a comment,
applies a label, or closes an issue. Writes stay behind the decider's approval
gates in `agents/triage/decider.py`, which exist so actions are not taken
without a maintainer -- an external client must not be able to route around
them. The GitHub write tools live in `tools.py` and are called only from inside
the graph.

Tool names are declared in `tool_names.py` like every other tool (root
`CLAUDE.md` rule 5); name drift caused two of the eight prototype bugs.

Imports are deliberately deferred into each function body. This module is
imported by `server.py` at stdio startup, and `rag` pulls in torch and
chromadb -- importing those eagerly would make every MCP client pay a
multi-second import to list the tools, including clients that only ever call
the cheap SQLite-backed ones.
"""

from __future__ import annotations

import json

from mcp_server.tools import mcp


def _dumps(payload: object) -> str:
    """JSON for an MCP client: stable key order, no surprise unicode escapes."""
    return json.dumps(payload, ensure_ascii=False, default=str)


@mcp.tool()
def search_issues_mcp(repo_name: str, query: str, limit: int = 5) -> str:
    """Semantic search over a repository's indexed issue history.

    Natural-language query; returns the closest issues with true cosine
    similarity scores (0-1, higher is closer). This is Doombot's RAG index
    exposed directly -- use it to find prior art, related reports, or whether
    something has been discussed before.

    Requires the repository to have been indexed. An empty result means either
    no match above the noise floor or nothing indexed yet.
    """
    from rag.retriever import retrieve_with_scores

    pairs = retrieve_with_scores(query, repo_name, kind="issues", k=limit)
    return _dumps(
        {
            "repo_name": repo_name,
            "query": query,
            "results": [
                {
                    "score": round(float(score), 3),
                    "number": (doc.metadata or {}).get("number"),
                    "state": (doc.metadata or {}).get("state"),
                    "labels": (doc.metadata or {}).get("labels"),
                    # First line is the title; the body follows after a blank
                    # line. Clients want the title, not a 4KB issue body.
                    "title": (doc.page_content or "").split("\n", 1)[0].strip(),
                }
                for doc, score in pairs
            ],
        }
    )


@mcp.tool()
def find_duplicates_mcp(repo_name: str, issue_number: int) -> str:
    """Check whether an issue duplicates something already reported.

    Returns two buckets with cosine scores: `duplicates` (above 0.85) and
    `related` (0.65-0.85). Anything below 0.65 is dropped as noise. The issue
    itself is always excluded -- it is in the index and would otherwise be its
    own perfect match.

    Thresholds are the same ones the triage graph uses, so a verdict here
    matches what the agent would decide.
    """
    from mcp_server.github_client import get_issue
    from rag.retriever import find_duplicates

    issue = get_issue(repo_name, issue_number)
    text = f"{issue.get('title', '')}\n\n{issue.get('body', '')}"
    found = find_duplicates(text, repo_name, exclude_number=issue_number)

    duplicates = found.get("duplicates") or []
    return _dumps(
        {
            "repo_name": repo_name,
            "issue_number": issue_number,
            "verdict": "duplicate" if duplicates else "not_a_duplicate",
            "duplicates": duplicates,
            "related": found.get("related") or [],
        }
    )


@mcp.tool()
def get_escalations_mcp(repo_name: str = "", severity: str = "") -> str:
    """What needs a maintainer's attention in this repository, right now.

    Use this for "what needs my attention", "what should I look at", "what is
    urgent", "any critical issues", or "show the escalation queue". This is the
    answer to those questions -- it is not a git or working-tree question.

    Returns the open escalation queue: issues Doombot investigated and decided
    it should *not* act on alone, each with its severity and the agent's stated
    reason. Optional filters: `repo_name` to scope to one repository,
    `severity` to narrow to one level (for example "critical").

    Costs no GitHub requests -- reads local storage only.
    """
    from memory import repo as store

    rows = store.list_escalations(resolved=False)
    items = []
    for row in rows:
        investigation = store.get_investigation(row["investigation_id"]) or {}
        if repo_name and investigation.get("repo_name") != repo_name:
            continue
        if severity and row.get("severity") != severity:
            continue
        items.append(
            {
                "investigation_id": row["investigation_id"],
                "repo_name": investigation.get("repo_name"),
                "issue_number": investigation.get("number"),
                "severity": row.get("severity"),
                "reason": row.get("reason"),
                "created_at": row.get("created_at"),
            }
        )
    return _dumps({"count": len(items), "escalations": items})


@mcp.tool()
def get_health_score_mcp(repo_name: str) -> str:
    """Project health: overall score plus its four weighted components.

    Components are security posture, backlog freshness, duplicate rate, and
    response health.

    Two fields must be read before the score is quoted:

      measured    false when the repository has no issues to score
      unreadable  true when the issues could not be read at all

    When either holds, `score` is meaningless and must not be reported as
    health. Three of the four components return 100 for an empty backlog, so a
    bare number claims perfect health for a repository nothing has been read
    from. `summary` states this in words so a client that ignores the flags
    still cannot quote a number that is not there.
    """
    from api import health as health_service

    result = health_service.compute(repo_name)
    measured = result.get("measured", True)
    unreadable = result.get("unreadable", False)

    if unreadable:
        summary = (
            "Health is unavailable: this repository's issues could not be read "
            "(usually an exhausted GitHub API quota). Do not report a score."
        )
    elif not measured:
        summary = (
            "Health is unavailable: this repository has no issues, so there is "
            "nothing to score. Do not report a score."
        )
    else:
        summary = f"Health score {result['score']} out of 100."

    return _dumps(
        {
            "repo_name": repo_name,
            "score": result.get("score"),
            "breakdown": result.get("breakdown"),
            "issue_count": result.get("issue_count", 0),
            "measured": measured,
            "unreadable": unreadable,
            "summary": summary,
        }
    )


@mcp.tool()
def get_investigation_mcp(investigation_id: str) -> str:
    """Why Doombot reached a decision -- the full reasoning chain with evidence.

    Use this for "why did it decide that", "show me the reasoning", "what
    evidence did it have", or "explain that verdict". Returns every step the
    agent took, in order, with the citations each one produced -- the same
    chain the dashboard renders.

    Pass an `investigation_id` from `list_investigations_mcp`. Costs no GitHub
    requests.
    """
    from memory import repo as store

    row = store.get_investigation(investigation_id)
    if row is None:
        return _dumps({"error": "no such investigation", "investigation_id": investigation_id})

    # `get_steps` already pops evidence_json and parses it into `evidence`.
    # Reading evidence_json here returned nothing on every step -- the chain
    # replayed with its reasoning silently stripped, which is the one thing
    # this tool exists to carry.
    steps = [
        {
            "seq": step.get("seq"),
            "name": step.get("name"),
            "title": step.get("title"),
            "status": step.get("status"),
            "duration_ms": step.get("duration_ms"),
            "evidence": step.get("evidence") or [],
        }
        for step in store.get_steps(investigation_id)
    ]

    return _dumps(
        {
            "investigation_id": investigation_id,
            "repo_name": row.get("repo_name"),
            "issue_number": row.get("number"),
            "status": row.get("status"),
            "decision": row.get("decision"),
            "decision_reason": row.get("decision_reason"),
            "confidence": row.get("confidence"),
            "impact_score": row.get("impact_score"),
            "steps": steps,
        }
    )


@mcp.tool()
def list_investigations_mcp(repo_name: str = "", limit: int = 20) -> str:
    """What Doombot has investigated recently, and what it decided.

    Use this for "what has the agent done", "recent activity", "what did it
    decide about issue N", or to find an `investigation_id` to pass to
    `get_investigation_mcp`. Optionally scoped to one repository.

    Costs no GitHub requests.
    """
    from memory import repo as store

    rows = store.list_investigations()
    if repo_name:
        rows = [row for row in rows if row["repo_name"] == repo_name]
    return _dumps(
        {
            "count": len(rows[:limit]),
            "investigations": [
                {
                    "investigation_id": row["id"],
                    "repo_name": row["repo_name"],
                    "issue_number": row["number"],
                    "status": row["status"],
                    "decision": row.get("decision"),
                    "created_at": row.get("created_at"),
                }
                for row in rows[:limit]
            ],
        }
    )


@mcp.tool()
def get_issue_graph_mcp(repo_name: str) -> str:
    """The issue relationship graph: nodes and weighted edges.

    Each node is an issue with its category and engagement; each edge states
    why the two are connected (cosine similarity, an explicit reference, or a
    shared label) and how strongly. Use it to reason about clusters of related
    reports rather than one issue at a time.
    """
    from rag.graph import build_graph

    graph = build_graph(repo_name, set())
    return _dumps(
        {
            "repo_name": repo_name,
            "stats": graph.get("stats"),
            "nodes": graph.get("nodes"),
            "links": graph.get("links"),
        }
    )
