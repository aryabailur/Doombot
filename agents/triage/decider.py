"""Final decision: escalate, auto-comment, or close as duplicate.

Node: decider
Reads:  duplicates, security_findings, impact_score, labels
Writes: decision  -> {action, reason, confidence}

Escalation categories (finalFeatures.md section 4): security, stale,
duplicate, high-impact. Low-confidence results are held back rather than
creating noise. Performs the real GitHub side effects (comment + labels)
via the shared MCP client.
"""
