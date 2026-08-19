"""Demo insurance — build by H16.

Pre-populates SQLite with 3 completed investigations (full chains), 4
escalations, and 7 health-score points.

If live GitHub or Groq fails mid-demo, present seeded data instead.
Pair with DEMO_MODE=1, which serves canned LLM responses — a Groq rate
limit at the worst possible moment is a real hackathon failure mode.

Run:  python -m scripts.seed_demo
"""
