"""Tests for POST /api/investigations/{id}/autofix.

Offline. `memory.repo` and `agents.triage.auto_fix.auto_fix_issue` are both
replaced, so nothing here touches SQLite, GitHub, or the embedding model --
the route's own job is small and worth testing on its own: look up the
investigation, recover the source pull request from the persisted chain, and
translate a result dict onto the wire contract.

The recovery step is the part that can silently rot. Nothing stores the source
PR in a column; it is read back out of the `patch_checker`/`resolver` steps'
evidence, so a change to what those nodes emit would break auto-fix on demand
with no type error and no failing import anywhere. That is what these assert.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api import routes_investigations as routes


@pytest.fixture
def client():
    return TestClient(app)


def _investigation(**overrides) -> dict:
    row = {
        "id": "inv-1",
        "repo_name": "octo/widget",
        "kind": "issue",
        "number": 42,
        "title": "octo/widget#42",
        "status": "done",
        "decision": "resolve",
        "decision_reason": "a known fix applies",
        "confidence": 0.9,
        "impact_score": 10.0,
        "created_at": "2026-08-21T00:00:00+00:00",
        "completed_at": "2026-08-21T00:00:10+00:00",
    }
    row.update(overrides)
    return row


def _step(name: str, evidence: list[dict]) -> dict:
    return {
        "step_id": f"step-{name}",
        "investigation_id": "inv-1",
        "seq": 0,
        "name": name,
        "title": name,
        "status": "done",
        "input_summary": "",
        "output_summary": "",
        "evidence": evidence,
        "duration_ms": 1,
        "started_at": "2026-08-21T00:00:00+00:00",
        "ended_at": "2026-08-21T00:00:01+00:00",
    }


@pytest.fixture
def wired(monkeypatch):
    """Stubs the row, the steps, and the engine; records what the route asked for."""
    calls: list[tuple] = []

    def fake_auto_fix_issue(repo_name, issue_number, source_pr=None, **_):
        calls.append((repo_name, issue_number, source_pr))
        return {
            "status": "opened",
            "reason": "opened a draft pull request replaying #145's fix.",
            "source_pr": source_pr,
            "pr_number": 302,
            "pr_url": "https://github.com/octo/widget/pull/302",
            "branch": "doombot/fix-42",
            "file": "src/app.py",
            "changed_lines": 5,
            "ci": True,
            "commented": True,
        }

    import agents.triage.auto_fix as engine

    monkeypatch.setattr(engine, "auto_fix_issue", fake_auto_fix_issue)
    monkeypatch.setattr(engine, "writes_allowed", lambda: True)

    state = {"row": _investigation(), "steps": []}
    monkeypatch.setattr(
        routes.repo, "get_investigation", lambda _id: state["row"]
    )
    monkeypatch.setattr(routes.repo, "get_steps", lambda _id: state["steps"])
    return state, calls


def test_unknown_investigation_is_404(client, monkeypatch):
    monkeypatch.setattr(routes.repo, "get_investigation", lambda _id: None)
    response = client.post("/api/investigations/nope/autofix")
    assert response.status_code == 404


def test_source_pr_comes_from_the_patch_checker_step(client, wired):
    state, calls = wired
    state["steps"] = [
        _step("resolver", [{"type": "pr", "ref": "111", "score": 0.8, "snippet": "x"}]),
        _step("patch_checker", [{"type": "pr", "ref": "145", "score": 0.7, "snippet": "y"}]),
    ]

    response = client.post("/api/investigations/inv-1/autofix")
    assert response.status_code == 200
    # patch_checker wins over resolver: it is the step that resolved the fix
    # against the current codebase.
    assert calls == [("octo/widget", 42, 145)]
    assert response.json()["pr_number"] == 302


def test_resolver_is_the_fallback_when_patch_checker_never_ran(client, wired):
    state, calls = wired
    state["steps"] = [
        _step("resolver", [{"type": "pr", "ref": "111", "score": 0.8, "snippet": "x"}]),
    ]

    client.post("/api/investigations/inv-1/autofix")
    assert calls == [("octo/widget", 42, 111)]


def test_rule_evidence_is_never_read_as_a_pr_number(client, wired):
    """Both steps also emit `rule` entries explaining why they found nothing.
    Reading a `ref` off one of those would request pull request #0."""
    state, calls = wired
    state["steps"] = [
        _step("patch_checker", [
            {"type": "rule", "ref": "patch_not_applicable", "score": None, "snippet": "z"},
        ]),
        _step("resolver", [
            {"type": "rule", "ref": "no_similar_resolved", "score": None, "snippet": "z"},
            {"type": "issue", "ref": "99", "score": 0.9, "snippet": "z"},
        ]),
    ]

    client.post("/api/investigations/inv-1/autofix")
    assert calls == [("octo/widget", 42, None)]


def test_evidence_stored_as_raw_json_is_still_read(client, wired):
    """`get_steps` normally decodes the column, but a partially written row
    must not make the whole lookup fail."""
    state, calls = wired
    step = _step("patch_checker", [])
    step["evidence"] = '[{"type": "pr", "ref": "145", "score": null, "snippet": "y"}]'
    state["steps"] = [step]

    client.post("/api/investigations/inv-1/autofix")
    assert calls == [("octo/widget", 42, 145)]


def test_demo_mode_is_reported_as_blocked_not_attempted(client, wired, monkeypatch):
    state, calls = wired
    import agents.triage.auto_fix as engine

    monkeypatch.setattr(engine, "writes_allowed", lambda: False)

    response = client.post("/api/investigations/inv-1/autofix")
    assert response.status_code == 200
    assert response.json()["status"] == "blocked"
    assert "DEMO_MODE" in response.json()["reason"]
    # Nothing was attempted, which is the whole point of the gate.
    assert calls == []


def test_a_pr_review_investigation_is_refused_not_attempted(client, wired):
    state, calls = wired
    state["row"] = _investigation(kind="pr")

    response = client.post("/api/investigations/inv-1/autofix")
    assert response.status_code == 200
    assert response.json()["status"] == "not_applicable"
    assert calls == []


def test_every_contract_field_survives_the_round_trip(client, wired):
    state, calls = wired
    state["steps"] = [
        _step("patch_checker", [{"type": "pr", "ref": "145", "score": 0.7, "snippet": "y"}]),
    ]

    body = client.post("/api/investigations/inv-1/autofix").json()
    assert body == {
        "status": "opened",
        "reason": "opened a draft pull request replaying #145's fix.",
        "source_pr": 145,
        "pr_number": 302,
        "pr_url": "https://github.com/octo/widget/pull/302",
        "branch": "doombot/fix-42",
        "file": "src/app.py",
        "changed_lines": 5,
        "ci": True,
        "commented": True,
    }
