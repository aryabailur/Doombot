"""Query and insert helpers over the SQLite tables.

Keeps raw SQL out of the API routes and the graph runner.

To implement:
    create_investigation / complete_investigation / get_investigation
    list_investigations / insert_step / get_steps
    create_escalation / list_escalations
    record_health_score / get_health_history
    record_feedback
"""
import json
from datetime import datetime, timezone

from memory.db import get_conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO investigations (
            id, repo_name, kind, number, title, status,
            decision, decision_reason, confidence, impact_score,
            created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, 'running', NULL, NULL, NULL, NULL, ?, NULL)
        """,
        (investigation_id, repo_name, kind, number, title, _now()),
    )
    conn.commit()


def complete_investigation(
    investigation_id: str,
    decision: str,
    decision_reason: str,
    confidence: float,
    impact_score: float,
) -> None:
    """Update the row: status='done', set decision fields, completed_at=now."""
    conn = get_conn()
    conn.execute(
        """
        UPDATE investigations
        SET status = 'done',
            decision = ?,
            decision_reason = ?,
            confidence = ?,
            impact_score = ?,
            completed_at = ?
        WHERE id = ?
        """,
        (decision, decision_reason, confidence, impact_score, _now(), investigation_id),
    )
    conn.commit()


def reconcile_orphaned_investigations() -> int:
    """Mark every investigation still 'running' as 'error' at startup.

    A 'running' row means an in-process background task was mid-flight —
    if the process restarted (crash, deploy, manual kill), that task is
    gone and nothing will ever move the row to 'done'. Without this, a
    restart during a live investigation leaves a permanently stuck card
    in the dashboard's attention queue. Returns the number of rows fixed.
    """
    conn = get_conn()
    cur = conn.execute(
        """
        UPDATE investigations
        SET status = 'error',
            decision = 'error',
            decision_reason = 'Investigation did not complete before the server restarted.',
            completed_at = ?
        WHERE status = 'running'
        """,
        (_now(),),
    )
    conn.commit()
    return cur.rowcount


def update_investigation_title(investigation_id: str, title: str) -> None:
    """Update just the title — used once the graph fetches the real
    issue/PR title, replacing the placeholder set at creation time."""
    conn = get_conn()
    conn.execute(
        "UPDATE investigations SET title = ? WHERE id = ?",
        (title, investigation_id),
    )
    conn.commit()


def get_investigation(investigation_id: str) -> dict | None:
    """Return the investigations row as a dict, or None if missing."""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM investigations WHERE id = ?", (investigation_id,)
    ).fetchone()
    return dict(row) if row is not None else None


def list_investigations() -> list[dict]:
    """Return all investigations, newest first (ORDER BY created_at DESC)."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM investigations ORDER BY created_at DESC"
    ).fetchall()
    return [dict(row) for row in rows]


def insert_step(step: dict) -> None:
    """Upsert one row into chain_steps, keyed on step_id.

    The chain_step decorator emits the same step_id twice — once with
    status='running', once with status='done'/'error' — so this must be
    an upsert, not a plain insert. `step['evidence']` (a list of dicts)
    is json.dumps'd into evidence_json before the write."""
    conn = get_conn()
    evidence_json = json.dumps(step["evidence"])
    tool_calls_json = json.dumps(step.get("tool_calls", []))
    conn.execute(
        """
        INSERT INTO chain_steps (
            step_id, investigation_id, seq, name, title, status,
            input_summary, output_summary, evidence_json, duration_ms,
            started_at, ended_at, tool_calls_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(step_id) DO UPDATE SET
            status = excluded.status,
            input_summary = excluded.input_summary,
            output_summary = excluded.output_summary,
            evidence_json = excluded.evidence_json,
            duration_ms = excluded.duration_ms,
            ended_at = excluded.ended_at,
            tool_calls_json = excluded.tool_calls_json
        """,
        (
            step["step_id"],
            step["investigation_id"],
            step["seq"],
            step["name"],
            step["title"],
            step["status"],
            step.get("input_summary"),
            step.get("output_summary"),
            evidence_json,
            step.get("duration_ms"),
            step["started_at"],
            step.get("ended_at"),
            tool_calls_json,
        ),
    )
    conn.commit()


def get_steps(investigation_id: str) -> list[dict]:
    """Return chain_steps rows for this investigation ordered by seq ASC,
    with evidence_json json.loads'd back into an `evidence` list on each dict."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM chain_steps WHERE investigation_id = ? ORDER BY seq ASC",
        (investigation_id,),
    ).fetchall()
    steps = []
    for row in rows:
        step = dict(row)
        evidence_json = step.pop("evidence_json", None)
        step["evidence"] = json.loads(evidence_json) if evidence_json else []
        tool_calls_json = step.pop("tool_calls_json", None)
        step["tool_calls"] = json.loads(tool_calls_json) if tool_calls_json else []
        steps.append(step)
    return steps


def create_escalation(
    investigation_id: str,
    repo_name: str,
    reason: str,
    severity: str,
) -> int:
    """Insert into escalations with resolved=0, created_at=now.
    Returns the new row's autoincrement id."""
    conn = get_conn()
    cur = conn.execute(
        """
        INSERT INTO escalations (
            investigation_id, repo_name, reason, severity, resolved, created_at
        ) VALUES (?, ?, ?, ?, 0, ?)
        """,
        (investigation_id, repo_name, reason, severity, _now()),
    )
    conn.commit()
    return cur.lastrowid


def list_escalations(resolved: bool | None = None) -> list[dict]:
    """Return escalations, optionally filtered by resolved status.
    None means return all."""
    conn = get_conn()
    if resolved is None:
        rows = conn.execute("SELECT * FROM escalations").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM escalations WHERE resolved = ?",
            (1 if resolved else 0,),
        ).fetchall()
    return [dict(row) for row in rows]


def resolve_escalation(escalation_id: int) -> None:
    """Set resolved=1 for the given escalation id."""
    conn = get_conn()
    conn.execute(
        "UPDATE escalations SET resolved = 1 WHERE id = ?", (escalation_id,)
    )
    conn.commit()


def record_health_score(
    repo_name: str,
    score: float,
    security: float,
    staleness: float,
    duplication: float,
    responsiveness: float,
) -> None:
    """Insert one row into health_scores with recorded_at=now."""
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO health_scores (
            repo_name, score, security, staleness, duplication,
            responsiveness, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (repo_name, score, security, staleness, duplication, responsiveness, _now()),
    )
    conn.commit()


def get_health_history(repo_name: str, limit: int = 30) -> list[dict]:
    """Return up to `limit` health_scores rows for repo_name, oldest first,
    for charting a trend line."""
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT * FROM (
            SELECT * FROM health_scores
            WHERE repo_name = ?
            ORDER BY recorded_at DESC
            LIMIT ?
        )
        ORDER BY recorded_at ASC
        """,
        (repo_name, limit),
    ).fetchall()
    return [dict(row) for row in rows]


def record_feedback(
    investigation_id: str,
    verdict: str,
    step_id: str | None = None,
    note: str | None = None,
) -> None:
    """Insert one row into feedback with created_at=now."""
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO feedback (
            investigation_id, step_id, verdict, note, created_at
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (investigation_id, step_id, verdict, note, _now()),
    )
    conn.commit()


def find_recent_open_investigation(repo_name: str, kind: str, number: int) -> dict | None:
    """Return the most recent non-error investigation for this
    (repo_name, kind, number), if one exists — used to avoid creating a
    second investigation (and duplicate attention-queue card) for an issue
    that already has one running or completed."""
    conn = get_conn()
    row = conn.execute(
        """
        SELECT * FROM investigations
        WHERE repo_name = ? AND kind = ? AND number = ? AND status != 'error'
        ORDER BY created_at DESC LIMIT 1
        """,
        (repo_name, kind, number),
    ).fetchone()
    return dict(row) if row is not None else None


def create_suggested_action(
    action_id: str,
    investigation_id: str,
    repo_name: str,
    number: int,
    kind: str,
    payload: dict,
    reason: str,
    confidence: float,
) -> None:
    """Insert one row into suggested_actions with status='pending'."""
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO suggested_actions (
            action_id, investigation_id, repo_name, number, kind,
            payload_json, reason, confidence, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """,
        (
            action_id,
            investigation_id,
            repo_name,
            number,
            kind,
            json.dumps(payload),
            reason,
            confidence,
            _now(),
        ),
    )
    conn.commit()


def list_suggested_actions(
    repo_name: str | None = None,
    investigation_id: str | None = None,
    status: str | None = "pending",
) -> list[dict]:
    """Return suggested_actions rows, newest first, optionally filtered by
    repo_name, investigation_id, and/or status (None = any status)."""
    conn = get_conn()
    clauses = []
    params: list = []
    if repo_name is not None:
        clauses.append("repo_name = ?")
        params.append(repo_name)
    if investigation_id is not None:
        clauses.append("investigation_id = ?")
        params.append(investigation_id)
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM suggested_actions {where} ORDER BY created_at DESC",
        params,
    ).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        item["payload"] = json.loads(item.pop("payload_json"))
        results.append(item)
    return results


def get_suggested_action(action_id: str) -> dict | None:
    """Return one suggested_actions row (payload_json decoded), or None."""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM suggested_actions WHERE action_id = ?", (action_id,)
    ).fetchone()
    if row is None:
        return None
    item = dict(row)
    item["payload"] = json.loads(item.pop("payload_json"))
    return item


def set_suggested_action_status(action_id: str, status: str) -> None:
    """Update a suggested_actions row's status ('approved' | 'rejected')."""
    conn = get_conn()
    conn.execute(
        "UPDATE suggested_actions SET status = ? WHERE action_id = ?",
        (status, action_id),
    )
    conn.commit()


def list_recent_steps(repo_name: str | None = None, limit: int = 50) -> list[dict]:
    """Return the most recent chain_steps joined with their investigation's
    repo_name/number, newest first — the source for a persistent activity
    feed. If repo_name is given, only steps whose investigation belongs to
    that repo are returned."""
    conn = get_conn()
    if repo_name is not None:
        rows = conn.execute(
            """
            SELECT cs.*, inv.repo_name AS inv_repo_name, inv.number AS inv_number
            FROM chain_steps cs
            JOIN investigations inv ON inv.id = cs.investigation_id
            WHERE inv.repo_name = ?
            ORDER BY cs.started_at DESC, cs.seq DESC
            LIMIT ?
            """,
            (repo_name, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT cs.*, inv.repo_name AS inv_repo_name, inv.number AS inv_number
            FROM chain_steps cs
            JOIN investigations inv ON inv.id = cs.investigation_id
            ORDER BY cs.started_at DESC, cs.seq DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    steps = []
    for row in rows:
        step = dict(row)
        evidence_json = step.pop("evidence_json", None)
        step["evidence"] = json.loads(evidence_json) if evidence_json else []
        tool_calls_json = step.pop("tool_calls_json", None)
        step["tool_calls"] = json.loads(tool_calls_json) if tool_calls_json else []
        steps.append(step)
    return steps

