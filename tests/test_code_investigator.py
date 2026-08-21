"""Code-aware issue diagnosis stays grounded and fails closed."""

from agents.triage import code_investigator
from rag import embedder, retriever


class _Doc:
    def __init__(self, content: str, metadata: dict):
        self.page_content = content
        self.metadata = metadata


def test_code_context_returns_ranked_distinct_locations(monkeypatch):
    monkeypatch.setattr(
        retriever,
        "retrieve_with_scores",
        lambda *_args, **_kwargs: [
            (_Doc("def authenticate(token):\n    return verify(token)", {
                "source": "api/auth.py", "symbol": "authenticate", "line_start": 42,
            }), 0.78),
            (_Doc("def authenticate(token):\n    return verify(token)", {
                "source": "api/auth.py", "symbol": "authenticate", "line_start": 42,
            }), 0.72),
            (_Doc("unrelated fixture", {"source": "tests/fixture.py"}), 0.2),
        ],
    )

    result = retriever.find_code_context("authentication fails", "owner/repo")

    assert result == [{
        "file_path": "api/auth.py",
        "symbol": "authenticate",
        "line_start": 42,
        "score": 0.78,
        "snippet": "def authenticate(token): return verify(token)",
    }]


def test_code_context_degrades_when_index_is_missing(monkeypatch):
    monkeypatch.setattr(
        retriever,
        "retrieve_with_scores",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("no collection")),
    )
    assert retriever.find_code_context("crash", "owner/repo") == []


def test_code_investigator_cites_files_as_candidates(monkeypatch):
    monkeypatch.setattr(code_investigator, "find_code_context", lambda *_args: [{
        "file_path": "api/auth.py",
        "symbol": "authenticate",
        "line_start": 42,
        "score": 0.78,
        "snippet": "def authenticate(token)",
    }])
    monkeypatch.setattr(code_investigator, "_analyze_candidates", lambda *_args: None)

    patch, evidence = code_investigator.code_investigator_node.__wrapped__({
        "repo_name": "owner/repo",
        "issue_metadata": {"title": "Login fails", "body": "Token rejected"},
    })

    assert patch["code_diagnosis"]["status"] == "candidate_locations"
    assert evidence[0]["type"] == "file"
    assert evidence[0]["ref"] == "api/auth.py:42"
    assert "not proof" in patch["code_diagnosis"]["summary"]


def test_code_investigator_reports_insufficient_evidence(monkeypatch):
    monkeypatch.setattr(code_investigator, "find_code_context", lambda *_args: [])

    patch, evidence = code_investigator.code_investigator_node.__wrapped__({
        "repo_name": "owner/repo",
        "issue_metadata": {"title": "Unknown failure", "body": ""},
    })

    assert patch["code_diagnosis"]["status"] == "insufficient_evidence"
    assert evidence[0]["ref"] == "insufficient_code_evidence"


def test_code_investigator_records_a_bounded_hypothesis(monkeypatch):
    monkeypatch.setattr(code_investigator, "find_code_context", lambda *_args: [{
        "file_path": "api/auth.py",
        "symbol": "authenticate",
        "line_start": 42,
        "score": 0.78,
        "snippet": "def authenticate(token)",
    }])
    monkeypatch.setattr(code_investigator, "_analyze_candidates", lambda *_args: {
        "primary_file": "api/auth.py",
        "primary_symbol": "authenticate",
        "confidence": 0.72,
        "summary": "The authentication path appears to reject the refreshed token format.",
    })

    patch, evidence = code_investigator.code_investigator_node.__wrapped__({
        "repo_name": "owner/repo",
        "issue_metadata": {"title": "Login fails", "body": "after refresh"},
    })

    diagnosis = patch["code_diagnosis"]
    assert diagnosis["status"] == "hypothesis"
    assert diagnosis["primary_file"] == "api/auth.py"
    assert any(item["ref"] == "root_cause_hypothesis" for item in evidence)


def test_code_index_extracts_common_python_and_typescript_symbols():
    assert embedder._chunk_symbol("async def investigate_issue(state):\n    pass") == "investigate_issue"
    assert embedder._chunk_symbol("export const loadPolicy = async () => {}") == "loadPolicy"
