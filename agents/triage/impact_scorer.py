"""Score issue impact 0-100.

Node: impact_scorer
Reads:  issue_metadata, duplicates, security_findings
Writes: impact_score

Signals: reactions/upvotes, comment count, participant count, age,
labels, whether it touches a core module.
"""
