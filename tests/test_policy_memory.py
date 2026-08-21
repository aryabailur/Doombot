"""Decision-derived repository policy remains explainable and approval-safe."""

import sqlite3

import pytest

from agents.triage import decider
from memory import db, repo


@pytest.fixture()
def policy_db(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db._DDL)
    monkeypatch.setattr(db, "_conn", conn)
    yield
    conn.close()


def _decision(index: int, approved: bool, action: str = "escalate") -> None:
    repo.create_proposed_action(
        action_id=f"action-{index}",
        investigation_id=f"inv-{index}",
        repo_name="owner/repo",
        issue_number=index,
        action=action,
        comment="Exact proposal",
        labels=["needs-triage"],
    )
    assert repo.decide_proposed_action(
        f"action-{index}", approved, "maintainer"
    )


def test_policy_observes_before_claiming_a_learned_preference(policy_db):
    _decision(1, True)
    _decision(2, False)

    policy = repo.get_repository_policy("owner/repo")

    assert policy["mode"] == "observing"
    assert policy["approval_rate"] == 0.5
    assert policy["actions"][0]["guidance"] == "observing"
    assert "explicit maintainer approval" in policy["learned_rules"][0]


def test_policy_learns_action_and_label_caution_from_rejections(policy_db):
    for index in range(1, 5):
        _decision(index, approved=index == 1)

    policy = repo.get_repository_policy("owner/repo")

    assert policy["mode"] == "learned"
    assert policy["actions"][0] == {
        "action": "escalate",
        "samples": 4,
        "approvals": 1,
        "rejections": 3,
        "approval_rate": 0.25,
        "guidance": "caution",
    }
    assert policy["labels"][0]["label"] == "needs-triage"
    assert any("Use caution" in rule for rule in policy["learned_rules"])


def test_decider_cites_policy_without_leaking_it_into_public_comment(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    state = {
        "repo_name": "owner/repo",
        "issue_number": 7,
        "security_findings": [],
        "duplicates": [],
        "impact_score": 90,
        "labels": ["needs-triage"],
        "repository_policy": {
            "mode": "learned",
            "minimum_samples": 3,
            "actions": [{
                "action": "escalate",
                "samples": 4,
                "approvals": 1,
                "rejections": 3,
                "approval_rate": 0.25,
                "guidance": "caution",
            }],
        },
    }

    patch, evidence = decider.decider_node.__wrapped__(state)

    decision = patch["decision"]
    assert "1 of 4" in decision["reason"]
    assert decision["policy"]["guidance"] == "caution"
    assert "1 of 4" not in decision["proposal"]["comment"]
    assert any(item["ref"] == "repository_policy" for item in evidence)
