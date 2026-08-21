"""Regression tests for the single-pass API graph runner."""

import asyncio

from agents import triage_graph
from api import runner


class FakeIssueApp:
    def __init__(self):
        self.stream_calls = 0
        self.invoke_calls = 0
        self.state = None

    async def astream(self, _state, stream_mode):
        assert stream_mode == ["custom", "updates"]
        self.stream_calls += 1
        self.state = _state
        yield "updates", {
            "issue_fetcher": {
                "issue_metadata": {"title": "Real GitHub issue title"},
            }
        }
        yield "custom", {
            "type": "step.completed",
            "data": {
                "step_id": "step-1",
                "investigation_id": "inv-1",
                "seq": 0,
                "name": "issue_fetcher",
                "title": "Fetching issue",
                "status": "done",
                "evidence": [],
                "started_at": "2026-08-21T00:00:00Z",
            },
        }
        yield "updates", {
            "decider": {
                "decision": {
                    "action": "escalate",
                    "reason": "Needs maintainer attention",
                    "confidence": 0.91,
                    "proposal": {
                        "comment": "Exact public comment",
                        "labels": ["needs-triage"],
                        "requires_approval": True,
                    },
                },
                "impact_score": 88,
                "chain": [{"ended_at": "2026-08-21T00:00:01Z"}],
            }
        }

    async def ainvoke(self, _state):
        self.invoke_calls += 1
        raise AssertionError("the graph must not execute a second time")


def test_run_investigation_uses_streamed_state_without_second_execution(monkeypatch):
    app = FakeIssueApp()
    monkeypatch.setattr(triage_graph, "issue_app", app)

    calls: dict[str, list] = {
        "titles": [],
        "completed": [],
        "proposals": [],
        "escalations": [],
        "broadcasts": [],
    }
    monkeypatch.setattr(runner.repo, "create_investigation", lambda **_kwargs: None)
    monkeypatch.setattr(
        runner.repo,
        "get_repository_policy",
        lambda repo_name: {"repo_name": repo_name, "mode": "observing"},
    )
    monkeypatch.setattr(runner.repo, "insert_step", lambda _step: None)
    monkeypatch.setattr(
        runner.repo,
        "update_investigation_title",
        lambda investigation_id, title: calls["titles"].append((investigation_id, title)),
    )
    monkeypatch.setattr(
        runner.repo,
        "complete_investigation",
        lambda **kwargs: calls["completed"].append(kwargs),
    )
    monkeypatch.setattr(
        runner.repo,
        "create_escalation",
        lambda **kwargs: calls["escalations"].append(kwargs),
    )
    monkeypatch.setattr(
        runner.repo,
        "create_proposed_action",
        lambda **kwargs: calls["proposals"].append(kwargs),
    )

    async def capture(event):
        calls["broadcasts"].append(event)

    monkeypatch.setattr(runner.ws, "broadcast", capture)

    asyncio.run(runner.run_investigation("inv-1", "owner/repo", "issue", 4))

    assert app.stream_calls == 1
    assert app.invoke_calls == 0
    assert app.state["repository_policy"] == {
        "repo_name": "owner/repo",
        "mode": "observing",
    }
    assert calls["titles"] == [("inv-1", "Real GitHub issue title")]
    assert calls["completed"][0]["decision"] == "escalate"
    assert calls["completed"][0]["confidence"] == 0.91
    assert calls["proposals"][0]["investigation_id"] == "inv-1"
    assert calls["proposals"][0]["comment"] == "Exact public comment"
    assert calls["proposals"][0]["labels"] == ["needs-triage"]
    assert calls["escalations"][0]["investigation_id"] == "inv-1"
