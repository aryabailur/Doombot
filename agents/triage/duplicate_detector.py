"""Semantic duplicate detection over the repo's indexed issues.

Node: duplicate_detector
Reads:  repo_name, issue_number, issue_metadata
Writes: duplicates

Uses rag.retriever.find_duplicates(). Thresholds per finalFeatures.md
section 6: >0.85 duplicate, 0.65-0.85 related.

CRITICAL: must exclude the issue's own number from results, or every
issue is its own perfect duplicate.
"""
