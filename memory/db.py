"""SQLite connection helper and schema DDL."""
import os
import sqlite3

_conn: sqlite3.Connection | None = None

_DDL = """
CREATE TABLE IF NOT EXISTS investigations (
    id TEXT PRIMARY KEY,
    repo_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT,
    status TEXT NOT NULL,
    decision TEXT,
    decision_reason TEXT,
    confidence REAL,
    impact_score REAL,
    created_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS chain_steps (
    step_id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id),
    seq INTEGER NOT NULL,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    input_summary TEXT,
    output_summary TEXT,
    evidence_json TEXT,
    duration_ms INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    tool_calls_json TEXT
);

CREATE TABLE IF NOT EXISTS escalations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    severity TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_name TEXT NOT NULL,
    score REAL NOT NULL,
    security REAL NOT NULL,
    staleness REAL NOT NULL,
    duplication REAL NOT NULL,
    responsiveness REAL NOT NULL,
    recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL,
    step_id TEXT,
    verdict TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suggested_actions (
    action_id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    confidence REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steps_inv ON chain_steps(investigation_id, seq);
CREATE INDEX IF NOT EXISTS idx_inv_repo ON investigations(repo_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_inv ON suggested_actions(investigation_id);
"""


def get_conn() -> sqlite3.Connection:
    """Return the shared connection: check_same_thread=False, WAL mode,
    row_factory=sqlite3.Row. Path from env DB_PATH, default ./doombot.db.
    Safe to call repeatedly — reuse a module-level singleton."""
    global _conn
    if _conn is None:
        db_path = os.getenv("DB_PATH", "./doombot.db")
        _conn = sqlite3.connect(db_path, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn


def init_db() -> None:
    """Run every CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
    statement from the DDL, then commit. Idempotent."""
    conn = get_conn()
    conn.executescript(_DDL)
    _migrate_add_columns(conn)
    conn.commit()


def _migrate_add_columns(conn: sqlite3.Connection) -> None:
    """CREATE TABLE IF NOT EXISTS doesn't add columns to a table that
    already exists from an earlier run — that requires ALTER TABLE. Guard
    each ADD COLUMN so re-running against an already-migrated DB is a
    no-op instead of an error."""
    existing = {row[1] for row in conn.execute("PRAGMA table_info(chain_steps)")}
    if "tool_calls_json" not in existing:
        conn.execute("ALTER TABLE chain_steps ADD COLUMN tool_calls_json TEXT")
