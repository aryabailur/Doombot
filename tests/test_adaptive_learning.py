"""F17 — adaptive repository learning.

Offline: no GitHub, no Groq, no Chroma. The LLM and the retriever are both
stubbed, because what needs guarding is the wiring around them -- that
precedents reach the prompt, that they are cited as evidence, and above all
that their absence degrades rather than breaks.
"""

from __future__ import annotations

import pytest

from agents.triage import labeler


PRECEDENTS = [
    {"number": 142, "score": 0.87, "labels": ["bug"], "title": "crash on upload"},
    {
        "number": 203,
        "score": 0.81,
        "labels": ["site-bug", "site:youtube"],
        "title": "extractor broke",
    },
]


class _Response:
    def __init__(self, content: str) -> None:
        self.content = content


def _stub_llm(monkeypatch, capture: dict, reply: str):
    """Capture the prompt the node builds, and return a fixed reply."""

    class _LLM:
        def invoke(self, prompt: str):
            capture["prompt"] = prompt
            return _Response(reply)

    monkeypatch.setattr(labeler, "_get_llm", lambda: _LLM())


def _state() -> dict:
    return {
        "repo_name": "owner/repo",
        "issue_number": 7,
        "issue_metadata": {
            "title": "Downloads fail with 403",
            "body": "Every video errors out.",
            "labels": [],
        },
        "chain": [],
    }


def test_precedents_reach_the_prompt(monkeypatch):
    capture: dict = {}
    _stub_llm(monkeypatch, capture, '{"labels": ["bug"], "confidence": 0.9, "reason": "crash"}')
    monkeypatch.setattr(labeler, "_precedents", lambda state, metadata: PRECEDENTS)

    labeler.labeler_node(_state())

    prompt = capture["prompt"]
    assert "#142" in prompt and "#203" in prompt
    assert "0.87" in prompt
    # The maintainer's own label must appear -- it is the signal.
    assert "site-bug" in prompt


def test_precedents_are_cited_as_evidence(monkeypatch):
    """A classification the reader cannot trace is the black box we replace."""
    capture: dict = {}
    _stub_llm(monkeypatch, capture, '{"labels": ["bug"], "confidence": 0.9, "reason": "crash"}')
    monkeypatch.setattr(labeler, "_precedents", lambda state, metadata: PRECEDENTS)

    _patch, evidence = labeler.labeler_node.__wrapped__(_state())

    cited = {item["ref"] for item in evidence if item["type"] == "issue"}
    assert cited == {"142", "203"}
    scored = [item for item in evidence if item["ref"] == "142"]
    assert scored and scored[0]["score"] == 0.87


def test_prompt_forbids_copying_precedent_labels(monkeypatch):
    """Precedent labels are usually outside the allowed vocabulary.

    Real example: yt-dlp labels these `site-bug` and `site:youtube`, neither of
    which is in ALLOWED_LABELS. Showing them is the point -- they carry the
    project's categorisation -- but the model must map rather than copy, or the
    parser drops every label and the issue silently falls to suggest-only.
    """
    capture: dict = {}
    _stub_llm(monkeypatch, capture, '{"labels": ["bug"], "confidence": 0.9, "reason": "x"}')
    monkeypatch.setattr(labeler, "_precedents", lambda state, metadata: PRECEDENTS)

    labeler.labeler_node(_state())

    prompt = capture["prompt"]
    assert "Do not copy them" in prompt
    for label in labeler.ALLOWED_LABELS:
        assert label in prompt


def test_no_precedents_uses_the_original_prompt(monkeypatch):
    """A young or unindexed repository must classify exactly as before."""
    capture: dict = {}
    _stub_llm(monkeypatch, capture, '{"labels": ["bug"], "confidence": 0.9, "reason": "x"}')
    monkeypatch.setattr(labeler, "_precedents", lambda state, metadata: [])

    patch, evidence = labeler.labeler_node.__wrapped__(_state())

    assert "Precedents from closed issues" not in capture["prompt"]
    assert not [item for item in evidence if item["type"] == "issue"]
    assert patch["labels"] == ["bug"]


def test_retrieval_failure_does_not_break_classification(monkeypatch):
    """The RAG store being unavailable must not stop triage.

    `_precedents` swallows deliberately: a classification that works today
    cannot start failing because precedent lookup did.
    """
    def _boom(*_args, **_kwargs):
        raise RuntimeError("chroma is down")

    monkeypatch.setattr(labeler, "find_precedents", _boom, raising=False)
    import rag.retriever

    monkeypatch.setattr(rag.retriever, "find_precedents", _boom)

    assert labeler._precedents(_state(), _state()["issue_metadata"]) == []


def test_precedent_labels_never_leak_into_the_output(monkeypatch):
    """Even if the model echoes a precedent label, the parser must reject it."""
    capture: dict = {}
    _stub_llm(
        monkeypatch,
        capture,
        '{"labels": ["site-bug", "site:youtube", "bug"], "confidence": 0.9, "reason": "x"}',
    )
    monkeypatch.setattr(labeler, "_precedents", lambda state, metadata: PRECEDENTS)

    patch, _evidence = labeler.labeler_node.__wrapped__(_state())

    assert patch["labels"] == ["bug"]


@pytest.mark.parametrize("threshold_name", ["RELATED_THRESHOLD"])
def test_precedent_threshold_is_not_redefined(threshold_name):
    """One definition of "similar enough" for the whole project.

    A second literal is how two parts of the same system start disagreeing
    about what counts as related.
    """
    import inspect

    from rag import retriever

    source = inspect.getsource(retriever.find_precedents)
    assert threshold_name in source
    assert "0.65" not in source, "threshold must be imported, not restated"
