"""SQLite connection helper and schema DDL."""
import os
from pathlib import Path
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
    ended_at TEXT
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

CREATE INDEX IF NOT EXISTS idx_steps_inv ON chain_steps(investigation_id, seq);
CREATE INDEX IF NOT EXISTS idx_inv_repo ON investigations(repo_name, created_at DESC);
"""


def get_conn() -> sqlite3.Connection:
    """Return the shared connection: check_same_thread=False, WAL mode,
    row_factory=sqlite3.Row. Path from env DB_PATH, default ./doombot.db.
    Safe to call repeatedly — reuse a module-level singleton."""
    global _conn
    if _conn is None:
        # Default resolved against the repository root, not the cwd. An MCP
        # client spawns the server with an arbitrary cwd, and "./doombot.db"
        # would then silently create a second, empty database rather than
        # opening the real one -- the tools would answer, truthfully, that
        # there are no investigations.
        # Resolved against the repository root whenever it is relative.
        #
        # Both the default and the .env value are relative ("./doombot.db"), and
        # relative means "relative to the cwd" -- fine under uvicorn started in
        # the repo, wrong for an MCP client, which spawns the server with an
        # arbitrary cwd. There sqlite happily *creates* a second, empty database
        # instead of failing, so the tools answer truthfully that there are no
        # investigations. An absolute DB_PATH is still honoured as given.
        repo_root = Path(__file__).resolve().parents[1]
        configured = Path(os.getenv("DB_PATH") or "doombot.db")
        db_path = str(
            configured if configured.is_absolute() else repo_root / configured
        )
        _conn = sqlite3.connect(db_path, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn


def init_db() -> None:
    """Run every CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
    statement from the DDL, then commit. Idempotent."""
    conn = get_conn()
    conn.executescript(_DDL)
    conn.commit()
