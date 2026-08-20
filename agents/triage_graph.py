"""Issue-triage LangGraph.

Sibling to `agents/orchestrator.py` (the PR-review graph). Two separate
StateGraphs over one shared GraphState — NOT one graph with a conditional
branch.

Linear flow:
    START -> issue_fetcher -> duplicate_detector -> security_scanner
          -> impact_scorer -> labeler -> decider -> END
"""
from langgraph.graph import StateGraph, START, END

from agents.state import GraphState
from agents.triage.issue_fetcher import issue_fetcher
from agents.triage.duplicate_detector import duplicate_detector
from agents.triage.security_scanner import security_scanner
from agents.triage.impact_scorer import impact_scorer
from agents.triage.labeler import labeler
from agents.triage.decider import decider

graph = StateGraph(GraphState)

graph.add_node("issue_fetcher", issue_fetcher)
graph.add_node("duplicate_detector", duplicate_detector)
graph.add_node("security_scanner", security_scanner)
graph.add_node("impact_scorer", impact_scorer)
graph.add_node("labeler", labeler)
graph.add_node("decider", decider)

graph.add_edge(START, "issue_fetcher")
graph.add_edge("issue_fetcher", "duplicate_detector")
graph.add_edge("duplicate_detector", "security_scanner")
graph.add_edge("security_scanner", "impact_scorer")
graph.add_edge("impact_scorer", "labeler")
graph.add_edge("labeler", "decider")
graph.add_edge("decider", END)

issue_app = graph.compile()
