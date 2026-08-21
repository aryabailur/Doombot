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


def update_investigation_title(investigation_id: str, title: str) -> None:
    """Replace the temporary owner/repo#number title with fetched GitHub data."""
    if not title.strip():
        return
    conn = get_conn()
    conn.execute(
        "UPDATE investigations SET title = ? WHERE id = ?",
        (title.strip(), investigation_id),
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


def _action_dict(row) -> dict | None:
    if row is None:
        return None
    action = dict(row)
    action["labels"] = json.loads(action.pop("labels_json") or "[]")
    result_json = action.pop("result_json", None)
    action["result"] = json.loads(result_json) if result_json else None
    return action


def create_proposed_action(
    action_id: str,
    investigation_id: str,
    repo_name: str,
    issue_number: int,
    action: str,
    comment: str,
    labels: list[str],
) -> dict:
    """Persist the exact GitHub payload awaiting maintainer approval."""
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO proposed_actions (
            id, investigation_id, repo_name, issue_number, action,
            comment, labels_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?)
        """,
        (
            action_id,
            investigation_id,
            repo_name,
            issue_number,
            action,
            comment or None,
            json.dumps(labels),
            _now(),
        ),
    )
    conn.commit()
    return get_proposed_action(action_id)


def get_proposed_action(action_id: str) -> dict | None:
    """Return one action with JSON fields decoded, or None when absent."""
    row = get_conn().execute(
        "SELECT * FROM proposed_actions WHERE id = ?", (action_id,)
    ).fetchone()
    return _action_dict(row)


def get_investigation_action(investigation_id: str) -> dict | None:
    """Return the single proposed action for an investigation, if any."""
    row = get_conn().execute(
        "SELECT * FROM proposed_actions WHERE investigation_id = ?",
        (investigation_id,),
    ).fetchone()
    return _action_dict(row)


def list_proposed_actions(
    status: str | None = None,
    repo_name: str | None = None,
) -> list[dict]:
    """List auditable actions newest first, optionally scoped by state/repo."""
    clauses: list[str] = []
    values: list[str] = []
    if status is not None:
        clauses.append("status = ?")
        values.append(status)
    if repo_name is not None:
        clauses.append("repo_name = ?")
        values.append(repo_name)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = get_conn().execute(
        f"SELECT * FROM proposed_actions{where} ORDER BY created_at DESC",
        values,
    ).fetchall()
    return [_action_dict(row) for row in rows]


def decide_proposed_action(
    action_id: str,
    approved: bool,
    decided_by: str,
    note: str | None = None,
) -> dict | None:
    """Atomically approve/reject a proposal only while it is pending."""
    conn = get_conn()
    status = "approved" if approved else "rejected"
    changed = conn.execute(
        """
        UPDATE proposed_actions
        SET status = ?, decided_by = ?, decision_note = ?, decided_at = ?
        WHERE id = ? AND status = 'proposed'
        """,
        (status, decided_by, note, _now(), action_id),
    ).rowcount
    conn.commit()
    return get_proposed_action(action_id) if changed else None


def mark_action_executing(action_id: str) -> bool:
    """Claim an approved action exactly once before making a GitHub call."""
    conn = get_conn()
    changed = conn.execute(
        """
        UPDATE proposed_actions SET status = 'executing'
        WHERE id = ? AND status = 'approved'
        """,
        (action_id,),
    ).rowcount
    conn.commit()
    return changed == 1


def complete_action(
    action_id: str,
    result: dict | None = None,
    error: str | None = None,
) -> dict | None:
    """Finish an executing action as verified or failed with an audit receipt."""
    conn = get_conn()
    status = "failed" if error else "verified"
    conn.execute(
        """
        UPDATE proposed_actions
        SET status = ?, result_json = ?, error = ?, executed_at = ?
        WHERE id = ? AND status = 'executing'
        """,
        (status, json.dumps(result) if result is not None else None, error, _now(), action_id),
    )
    conn.commit()
    return get_proposed_action(action_id)


_APPROVED_STATUSES = {"approved", "executing", "verified", "failed"}
_POLICY_MIN_SAMPLES = 3


def _policy_guidance(samples: int, approval_rate: float) -> str:
    """Translate decision history into a conservative, explainable signal."""
    if samples < _POLICY_MIN_SAMPLES:
        return "observing"
    if approval_rate <= 0.34:
        return "caution"
    if approval_rate >= 0.75:
        return "aligned"
    return "mixed"


def get_repository_policy(repo_name: str) -> dict:
    """Derive an auditable policy profile from persisted maintainer decisions.

    Approval history never enables automatic writes. It is a preference signal
    used by later investigations and remains separate from evidence confidence.
    Failed executions still count as approvals because the maintainer approved
    the proposal; transport/tool failure is not negative policy feedback.
    """
    rows = get_conn().execute(
        """
        SELECT action, labels_json, status, decided_at
        FROM proposed_actions
        WHERE repo_name = ? AND decided_at IS NOT NULL
        ORDER BY decided_at ASC
        """,
        (repo_name,),
    ).fetchall()

    action_counts: dict[str, dict[str, int]] = {}
    label_counts: dict[str, dict[str, int]] = {}
    approvals = 0
    rejections = 0
    updated_at = None

    for row in rows:
        approved = row["status"] in _APPROVED_STATUSES
        approvals += int(approved)
        rejections += int(not approved)
        updated_at = row["decided_at"] or updated_at

        action = row["action"]
        bucket = action_counts.setdefault(action, {"approvals": 0, "rejections": 0})
        bucket["approvals" if approved else "rejections"] += 1

        for label in json.loads(row["labels_json"] or "[]"):
            label_bucket = label_counts.setdefault(
                label, {"approvals": 0, "rejections": 0}
            )
            label_bucket["approvals" if approved else "rejections"] += 1

    def profiles(counts: dict[str, dict[str, int]], key: str) -> list[dict]:
        result = []
        for name, values in counts.items():
            samples = values["approvals"] + values["rejections"]
            rate = values["approvals"] / samples
            result.append({
                key: name,
                "samples": samples,
                "approvals": values["approvals"],
                "rejections": values["rejections"],
                "approval_rate": round(rate, 3),
                "guidance": _policy_guidance(samples, rate),
            })
        return sorted(result, key=lambda item: (-item["samples"], item[key]))

    action_profiles = profiles(action_counts, "action")
    label_profiles = profiles(label_counts, "label")
    total = approvals + rejections
    learned_rules = ["Every GitHub write still requires explicit maintainer approval."]
    for profile in action_profiles:
        if profile["guidance"] == "caution":
            learned_rules.append(
                f"Use caution with {profile['action'].replace('_', ' ')} proposals: "
                f"maintainers approved {profile['approvals']} of {profile['samples']}."
            )
        elif profile["guidance"] == "aligned":
            learned_rules.append(
                f"{profile['action'].replace('_', ' ').title()} proposals align with "
                f"maintainer history ({profile['approvals']} of {profile['samples']} approved)."
            )

    return {
        "repo_name": repo_name,
        "mode": "learned" if total >= _POLICY_MIN_SAMPLES else "observing",
        "minimum_samples": _POLICY_MIN_SAMPLES,
        "total_decisions": total,
        "approvals": approvals,
        "rejections": rejections,
        "approval_rate": round(approvals / total, 3) if total else None,
        "actions": action_profiles,
        "labels": label_profiles,
        "learned_rules": learned_rules,
        "updated_at": updated_at,
    }


def _fix_run_dict(row) -> dict | None:
    if row is None:
        return None
    item = dict(row)
    item["commands"] = json.loads(item.pop("commands_json") or "[]")
    item["receipts"] = json.loads(item.pop("receipts_json") or "[]")
    return item


def create_fix_run(
    run_id: str,
    investigation_id: str,
    repo_name: str,
    issue_number: int,
) -> dict:
    """Create an explicit, non-publishing Fix Lab run."""
    now = _now()
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO fix_runs (
            id, investigation_id, repo_name, issue_number, status,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', ?, ?)
        """,
        (run_id, investigation_id, repo_name, issue_number, now, now),
    )
    conn.commit()
    return get_fix_run(run_id)


def get_fix_run(run_id: str) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM fix_runs WHERE id = ?", (run_id,)
    ).fetchone()
    return _fix_run_dict(row)


def list_fix_runs(repo_name: str | None = None) -> list[dict]:
    if repo_name:
        rows = get_conn().execute(
            "SELECT * FROM fix_runs WHERE repo_name = ? ORDER BY created_at DESC",
            (repo_name,),
        ).fetchall()
    else:
        rows = get_conn().execute(
            "SELECT * FROM fix_runs ORDER BY created_at DESC"
        ).fetchall()
    return [_fix_run_dict(row) for row in rows]


def fail_interrupted_fix_runs() -> int:
    """Fail non-terminal runs left behind by a single-process API restart."""
    now = _now()
    conn = get_conn()
    cursor = conn.execute(
        """
        UPDATE fix_runs
        SET status = 'failed',
            error = 'Fix Lab run was interrupted by a backend restart.',
            updated_at = ?
        WHERE status IN ('queued', 'preparing', 'generating', 'verifying', 'publishing')
        """,
        (now,),
    )
    conn.commit()
    return cursor.rowcount


def update_fix_run(run_id: str, status: str, **fields) -> dict | None:
    """Update an allowlisted set of Fix Lab fields and its timestamp."""
    allowed = {
        "base_sha", "summary", "patch_diff", "commands", "receipts", "error",
        "decided_by", "decision_note", "decided_at", "published_at",
    }
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"unsupported fix-run fields: {sorted(unknown)}")
    encoded = dict(fields)
    if "commands" in encoded:
        encoded["commands_json"] = json.dumps(encoded.pop("commands"))
    if "receipts" in encoded:
        encoded["receipts_json"] = json.dumps(encoded.pop("receipts"))
    encoded["status"] = status
    encoded["updated_at"] = _now()
    assignments = ", ".join(f"{key} = ?" for key in encoded)
    values = [*encoded.values(), run_id]
    conn = get_conn()
    conn.execute(
        f"UPDATE fix_runs SET {assignments} WHERE id = ?",
        values,
    )
    conn.commit()
    return get_fix_run(run_id)


def decide_fix_run(
    run_id: str,
    approved: bool,
    decided_by: str,
    note: str | None = None,
) -> dict | None:
    """Atomically approve/reject a verified proposal without publishing it."""
    now = _now()
    status = "approved" if approved else "rejected"
    conn = get_conn()
    changed = conn.execute(
        """
        UPDATE fix_runs
        SET status = ?, decided_by = ?, decision_note = ?,
            decided_at = ?, updated_at = ?
        WHERE id = ? AND status = 'proposed'
        """,
        (status, decided_by, note, now, now, run_id),
    ).rowcount
    conn.commit()
    return get_fix_run(run_id) if changed else None
