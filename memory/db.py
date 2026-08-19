"""SQLite connection and schema initialization.

Stdlib sqlite3 (no aiosqlite — writes are sub-millisecond at demo scale).
check_same_thread=False, WAL mode. init_db() runs inline
CREATE TABLE IF NOT EXISTS DDL; no migration tooling.

Tables: investigations, chain_steps, escalations, health_scores, feedback.
Full DDL in the plan at ~/.claude/plans/doombot-hackathon-plan.md

To implement:
    get_conn() -> sqlite3.Connection
    init_db() -> None
"""
