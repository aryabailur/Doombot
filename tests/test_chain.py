"""Regression tests for the chain_step decorator.

These lock in the invariants the dashboard depends on. If any fails, the
live trace, SQLite persistence, or refresh-replay is broken.

No network, no API keys -- safe to run in CI.
"""

import pytest

from agents.chain import _next_seq, _split, chain_step

STEP_KEYS = {
    "step_id", "investigation_id", "seq", "name", "title", "status",
    "input_summary", "output_summary", "evidence", "duration_ms",
    "started_at", "ended_at",
}


def test_patch_only_return():
    @chain_step("t", "T")
    def node(state):
        return {"impact_score": 42}

    out = node({"chain": []})
    assert out["impact_score"] == 42
    assert len(out["chain"]) == 1
    assert out["chain"][0]["status"] == "done"


def test_patch_and_evidence_return():
    @chain_step("t", "T")
    def node(state):
        return {"labels": ["bug"]}, [{"type": "rule", "ref": "r", "score": None, "snippet": "s"}]

    rec = node({"chain": []})["chain"][0]
    assert len(rec["evidence"]) == 1
    assert set(rec["evidence"][0]) == {"type", "ref", "score", "snippet"}


def test_step_record_shape_is_exact():
    """The dashboard and Stream A's SQLite schema both key off these fields."""
    @chain_step("t", "T")
    def node(state):
        return {}

    assert set(node({"chain": []})["chain"][0]) == STEP_KEYS


def test_error_is_reported_then_reraised():
    @chain_step("t", "T")
    def node(state):
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        node({"chain": []})


def test_seq_derives_from_chain_length():
    assert _next_seq({"chain": []}) == 0
    assert _next_seq({"chain": [1, 2, 3]}) == 3


def test_returns_only_the_new_record():
    """Must return [rec], not chain + [rec] -- the add reducer accumulates.

    Returning the whole chain double-appends every step under the reducer.
    """
    @chain_step("t", "T")
    def node(state):
        return {}

    assert len(node({"chain": [{"seq": 0}, {"seq": 1}]})["chain"]) == 1


def test_split_accepts_both_shapes_and_rejects_junk():
    assert _split({"a": 1}) == ({"a": 1}, [])
    assert _split(({"a": 1}, [{"x": 1}])) == ({"a": 1}, [{"x": 1}])
    with pytest.raises(TypeError):
        _split("not a dict")


def test_node_never_imports_persistence_or_transport():
    """Rule zero: nodes stay ignorant of memory/ and api/ (root CLAUDE.md 4)."""
    import pathlib
    for path in pathlib.Path("agents").rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        assert "from memory" not in src and "import memory" not in src, path
        assert "from api" not in src and "import api" not in src, path


def test_stream_envelope_uses_data_key():
    """Events must be {type, data}, not {type, step}.

    api/CLAUDE.md and dashboard/CLAUDE.md both specify `data`, and Stream C's
    useSocket hook rejects any event lacking it -- so an envelope mismatch
    silently drops every step from the live trace while the backend looks
    perfectly healthy. This test is the only thing that catches it without
    running both halves together.
    """
    from langgraph.graph import END, START, StateGraph

    from agents.state import GraphState

    @chain_step("t", "T")
    def node(state):
        return {}

    graph = StateGraph(GraphState)
    graph.add_node("t", node)
    graph.add_edge(START, "t")
    graph.add_edge("t", END)
    app = graph.compile()

    events = list(app.stream({"chain": []}, stream_mode="custom"))
    assert events, "no custom events emitted"
    for event in events:
        assert set(event) == {"type", "data"}, event
        assert event["type"] in {"step.started", "step.completed"}
        assert set(event["data"]) == STEP_KEYS
