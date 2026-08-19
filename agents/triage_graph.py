"""Issue-triage LangGraph.

Sibling to `agents/orchestrator.py` (the PR-review graph). Two separate
StateGraphs over one shared GraphState — NOT one graph with a conditional
branch.

Planned linear flow:
    START -> issue_fetcher -> duplicate_detector -> security_scanner
          -> impact_scorer -> labeler -> decider

Exports:
    issue_app = graph.compile()
"""
