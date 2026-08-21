# memory/ — SQLite persistence layer

**Owner:** Person A (Stream A) · **Branch prefix:** `feat/a-<slug>`

Read the root `CLAUDE.md` first. This file governs everything under `memory/`.

---

## 1. Purpose

`memory/` is the persistence layer: schema, connection helper, and query
functions over SQLite. It's what makes the chain **replay-proof** — a page
refresh or API restart mid-demo doesn't lose an investigation's steps,
because they were never only in memory or only on the socket.

## 2. stdlib `sqlite3` only

Use the standard library `sqlite3` module. **Do not add `aiosqlite`.** At
demo scale, writes to a local SQLite file are sub-millisecond — an async
driver buys nothing here and is one more dependency to install on venue
wifi. If a future call site needs to await something, wrap the sync call in
a thread (`asyncio.to_thread`) rather than switching drivers.

---

## 3. Connection rules

- `check_same_thread=False` — the connection is shared across the FastAPI
  event loop and any background tasks.
- WAL mode: `PRAGMA journal_mode=WAL` — lets reads and writes overlap without
  "database is locked" errors during a live-streamed investigation.
- `conn.row_factory = sqlite3.Row` — every query result is dict-like
  (`row["field"]`), not a positional tuple. Every helper in `repo.py` relies
  on this.
- DB path comes from the `DB_PATH` env var, default `./doombot.db`.

---

## 4. Schema — exact DDL

This is the **complete, verbatim** DDL. Copy it into `memory/db.py` exactly
as written — do not reorder columns, rename them, or add a migration
framework. Every `CREATE TABLE` uses `IF NOT EXISTS`.

```sql
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

CREATE TABLE IF NOT EXISTS proposed_actions (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL UNIQUE REFERENCES investigations(id),
    repo_name TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    action TEXT NOT NULL,
    comment TEXT,
    labels_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (
        status IN ('proposed', 'approved', 'rejected', 'executing', 'verified', 'failed')
    ),
    decided_by TEXT,
    decision_note TEXT,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    executed_at TEXT
);

CREATE TABLE IF NOT EXISTS fix_runs (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id),
    repo_name TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    base_sha TEXT,
    summary TEXT,
    patch_diff TEXT,
    commands_json TEXT NOT NULL DEFAULT '[]',
    receipts_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    decided_by TEXT,
    decision_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    decided_at TEXT,
    published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_steps_inv ON chain_steps(investigation_id, seq);
CREATE INDEX IF NOT EXISTS idx_inv_repo ON investigations(repo_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_status ON proposed_actions(status, created_at DESC);
```

No migration framework. If the schema needs to change, edit the DDL above,
announce it (it affects `api/schemas.py` too — see `api/CLAUDE.md` §2), and
everyone re-runs `init_db()` against a fresh file.

---

## 5. The evidence asymmetry — easy to miss

`chain_steps.evidence_json` is stored as **TEXT**, produced with
`json.dumps(evidence_list)` on write. It is **not** a native SQLite JSON
column. Every read path must `json.loads(row["evidence_json"])` before
handing it to a Pydantic model or the WebSocket.

**This is the single easiest bug to introduce in this module.** If
`get_steps()` or `get_investigation()` forgets the `json.loads`, the API
will either crash serializing a string-that-looks-like-a-list, or worse,
silently hand the frontend a JSON string instead of an array. Test this
path explicitly.

---

## 6. `memory/store.py` is dead — delete it

`memory/store.py` is a legacy, empty, 0-byte file. It should be **deleted**
in the first PR that touches `memory/`. Do not add anything to it, and do
not treat its existence as meaning something used to live there that you
need to preserve — nothing does.

---

## 7. Function signatures

### `memory/db.py`

```python
def get_conn() -> sqlite3.Connection:
    """Return the shared connection: check_same_thread=False, WAL mode,
    row_factory=sqlite3.Row. Path from env DB_PATH, default ./doombot.db.
    Safe to call repeatedly — reuse a module-level singleton."""

def init_db() -> None:
    """Run every CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
    statement from the DDL above, then commit. Idempotent."""
```

### `memory/repo.py`

```python
def create_investigation(
    investigation_id: str,
    repo_name: str,
    kind: str,
    number: int,
    title: str,
) -> None:
    """Insert a new row into investigations with status='running',
    created_at=now (ISO 8601 UTC), decision/decision_reason/confidence/
    impact_score/completed_at left NULL."""

def complete_investigation(
    investigation_id: str,
    decision: str,
    decision_reason: str,
    confidence: float,
    impact_score: float,
) -> None:
    """Update the row: status='done', set decision fields, completed_at=now."""

def get_investigation(investigation_id: str) -> dict | None:
    """Return the investigations row as a dict, or None if missing."""

def list_investigations() -> list[dict]:
    """Return all investigations, newest first (ORDER BY created_at DESC)."""

def insert_step(step: dict) -> None:
    """Insert one row into chain_steps. `step['evidence']` (a list of dicts)
    is json.dumps'd into evidence_json before the INSERT."""

def get_steps(investigation_id: str) -> list[dict]:
    """Return chain_steps rows for this investigation ordered by seq ASC,
    with evidence_json json.loads'd back into an `evidence` list on each dict."""

def create_escalation(
    investigation_id: str,
    repo_name: str,
    reason: str,
    severity: str,
) -> int:
    """Insert into escalations with resolved=0, created_at=now.
    Returns the new row's autoincrement id."""

def list_escalations(resolved: bool | None = None) -> list[dict]:
    """Return escalations, optionally filtered by resolved status.
    None means return all."""

def resolve_escalation(escalation_id: int) -> None:
    """Set resolved=1 for the given escalation id."""

def record_health_score(
    repo_name: str,
    score: float,
    security: float,
    staleness: float,
    duplication: float,
    responsiveness: float,
) -> None:
    """Insert one row into health_scores with recorded_at=now."""

def get_health_history(repo_name: str, limit: int = 30) -> list[dict]:
    """Return up to `limit` health_scores rows for repo_name, oldest first,
    for charting a trend line."""

def record_feedback(
    investigation_id: str,
    verdict: str,
    step_id: str | None = None,
    note: str | None = None,
) -> None:
    """Insert one row into feedback with created_at=now."""

def create_proposed_action(...) -> dict:
    """Persist the exact comment/labels payload with status='proposed'."""

def get_proposed_action(action_id: str) -> dict | None:
    """Return one decoded action or None."""

def get_investigation_action(investigation_id: str) -> dict | None:
    """Return the single action associated with an investigation."""

def list_proposed_actions(status: str | None = None, repo_name: str | None = None) -> list[dict]:
    """Return newest-first actions, optionally filtered by status/repository."""

def decide_proposed_action(...) -> dict | None:
    """Atomically transition proposed -> approved/rejected."""

def mark_action_executing(action_id: str) -> bool:
    """Atomically claim an approved action exactly once."""

def complete_action(...) -> dict | None:
    """Persist verified/failed status and the execution receipt."""

def get_repository_policy(repo_name: str) -> dict:
    """Derive conservative action/label guidance from decided proposals."""
```

---

## 8. Timestamps

Every timestamp column in every table is an **ISO 8601 UTC string**,
produced with:

```python
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
```

Never use `datetime.utcnow()` (naive, no offset, deprecated), never store a
Unix epoch int, never format manually. Every function in §7 that writes a
timestamp uses this exact call. Consistency here matters because the
frontend sorts and diffs timestamps as strings — a mixed format silently
breaks ordering.

---

## 9. Verification

```bash
python -c "from memory.db import init_db, get_conn; init_db(); \
c = get_conn(); \
print([r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")])"
```

Expect: `['investigations', 'chain_steps', 'escalations', 'health_scores', 'feedback', 'proposed_actions', 'fix_runs']`
(order may vary; `sqlite_sequence` may also appear if any autoincrement
table has been written to).

```bash
python -c "
from memory.db import init_db
from memory import repo
init_db()
repo.create_investigation('test-1', 'octocat/Hello-World', 'issue', 1, 'Test issue')
print(repo.get_investigation('test-1'))
repo.insert_step({
    'step_id': 's1', 'investigation_id': 'test-1', 'seq': 0,
    'name': 'fetch', 'title': 'Fetch issue', 'status': 'done',
    'input_summary': '', 'output_summary': 'ok', 'evidence': [],
    'duration_ms': 12, 'started_at': '2026-08-20T00:00:00+00:00',
    'ended_at': '2026-08-20T00:00:01+00:00',
})
print(repo.get_steps('test-1'))
"
```

Confirm `evidence` in the printed step is a Python list, not a string.

---

## 10. Task breakdown

| Task | File(s) | Branch |
|---|---|---|
| Connection helper + DDL + init_db | `memory/db.py` | `feat/a-memory-db` |
| Delete legacy empty file | `memory/store.py` (delete) | `feat/a-memory-db` (same PR) |
| Investigation CRUD helpers | `memory/repo.py` | `feat/a-memory-repo-investigations` |
| Step insert/read + evidence_json handling | `memory/repo.py` | `feat/a-memory-repo-steps` |
| Escalation helpers | `memory/repo.py` | `feat/a-memory-repo-escalations` |
| Health score helpers | `memory/repo.py` | `feat/a-memory-repo-health` |
| Feedback helper | `memory/repo.py` | `feat/a-memory-repo-feedback` |

---

## Definition of done

- [ ] `memory/db.py` DDL matches §4 verbatim, all `IF NOT EXISTS`
- [ ] `get_conn()` uses `check_same_thread=False`, WAL, `row_factory=sqlite3.Row`
- [ ] `DB_PATH` env var respected, default `./doombot.db`
- [ ] `memory/store.py` deleted
- [ ] Every function in §7 exists with the exact signature
- [ ] `insert_step` writes `evidence_json` via `json.dumps`; `get_steps` reads it back via `json.loads`
- [ ] Every timestamp written via `datetime.now(timezone.utc).isoformat()`
- [ ] No migration framework, no ORM
- [ ] Verification commands in §9 run clean, output pasted in the PR
