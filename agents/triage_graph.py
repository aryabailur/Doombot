"""Issue-triage LangGraph.

Sibling to agents/orchestrator.py (the PR-review graph). Two separate
StateGraphs over one shared GraphState -- NOT one graph with a conditional
branch. See agents/CLAUDE.md section 1 for why.

Purely linear, same style as orchestrator.py. No conditional edges in v1.
"""

from langgraph.graph import END, START, StateGraph

from agents.state import GraphState
from agents.triage.auto_fixer import fix_pr_opener_node, patch_checker_node
from agents.triage.decider import decider_node
from agents.triage.duplicate_detector import duplicate_detector_node
from agents.triage.impact_scorer import impact_scorer_node
from agents.triage.issue_fetcher import issue_fetcher_node
from agents.triage.labeler import labeler_node
from agents.triage.resolver import resolver_node
from agents.triage.security_scanner import security_scanner_node

graph = StateGraph(GraphState)
graph.add_node("issue_fetcher", issue_fetcher_node)
graph.add_node("duplicate_detector", duplicate_detector_node)
graph.add_node("resolver", resolver_node)
graph.add_node("security_scanner", security_scanner_node)
graph.add_node("impact_scorer", impact_scorer_node)
graph.add_node("labeler", labeler_node)
graph.add_node("decider", decider_node)
graph.add_node("patch_checker", patch_checker_node)
graph.add_node("fix_pr_opener", fix_pr_opener_node)

graph.add_edge(START, "issue_fetcher")
graph.add_edge("issue_fetcher", "duplicate_detector")
# resolver sits between duplicates and security: it needs the similarity
# search, and must not pre-empt a security escalation.
graph.add_edge("duplicate_detector", "resolver")
graph.add_edge("resolver", "security_scanner")
graph.add_edge("security_scanner", "impact_scorer")
graph.add_edge("impact_scorer", "labeler")
graph.add_edge("labeler", "decider")
# Auto-fix runs after decider, not alongside it: decider is the node that
# owns the triage decision and the triage comment, and there is nothing for
# patch_checker to replay until an action has actually been chosen. Linear,
# like the rest of this graph -- patch_checker and fix_pr_opener gate
# themselves and record why, the same way resolver always runs and often
# reports that it found nothing, rather than the graph branching around them.
graph.add_edge("decider", "patch_checker")
graph.add_edge("patch_checker", "fix_pr_opener")
graph.add_edge("fix_pr_opener", END)

issue_app = graph.compile()
