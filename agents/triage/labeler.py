"""Classify the issue and decide which GitHub labels to apply.

Node: labeler
Reads:  issue_metadata, duplicates, security_findings
Writes: labels

Per finalFeatures.md section 8: auto-apply above the confidence threshold
(default 0.85); below it, suggest only and await maintainer approval.
"""
