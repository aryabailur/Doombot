"""Two-layer security detection.

Node: security_scanner
Reads:  issue_metadata
Writes: security_findings

Layer 1 (MUST-HAVE): deterministic keyword match — xss, injection, csrf,
bypass, vulnerability, exploit, auth, overflow, secret/token/key leakage.
Layer 2 (CUT unless ahead of schedule): LLM confirmation that the term is
a genuine concern rather than an incidental mention.
"""
