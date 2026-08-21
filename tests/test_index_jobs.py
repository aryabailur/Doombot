"""Repository indexing reports reusable, observable job state."""

import asyncio

import pytest

from api import routes_repos
from rag import embedder


@pytest.fixture(autouse=True)
def clear_jobs():
    routes_repos._index_jobs.clear()
    routes_repos._repo_index_jobs.clear()


def test_index_returns_ready_when_both_collections_exist(monkeypatch):
    monkeypatch.setattr(embedder, "collection_count", lambda *_args: 4)

    result = asyncio.run(routes_repos.trigger_index("owner", "repo"))

    assert result.job_id == "ready"
    assert result.status == "ready"


def test_index_job_tracks_code_and_issue_completion(monkeypatch):
    monkeypatch.setattr(embedder, "collection_count", lambda *_args: 0)
    calls = []
    monkeypatch.setattr(embedder, "index_repo_files", lambda name: calls.append(("code", name)))
    monkeypatch.setattr(
        embedder,
        "index_issues",
        lambda name, state, limit: calls.append(("issues", name, state, limit)),
    )

    async def scenario():
        started = await routes_repos.trigger_index("owner", "repo")
        for _ in range(20):
            current = await routes_repos.get_index_job(started.job_id)
            if current.status == "done":
                return started, current
            await asyncio.sleep(0.01)
        raise AssertionError("index job did not finish")

    started, current = asyncio.run(scenario())

    assert started.status in {"queued", "running"}
    assert current.status == "done"
    assert calls == [
        ("code", "owner/repo"),
        ("issues", "owner/repo", "all", 200),
    ]
