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
    """Insert one row into chain_steps. `step['evidence']` (a list of dicts)
    is json.dumps'd into evidence_json before the INSERT."""
    conn = get_conn()
    evidence_json = json.dumps(step["evidence"])
    conn.execute(
        """
        INSERT INTO chain_steps (
            step_id, investigation_id, seq, name, title, status,
            input_summary, output_summary, evidence_json, duration_ms,
            started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
