"""Fix Lab safety boundaries and persisted lifecycle."""

import asyncio
from pathlib import Path
import sqlite3
import subprocess

import pytest

from fixlab import generator, sandbox, service
from memory import db, repo


@pytest.fixture()
def fix_db(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db._DDL)
    monkeypatch.setattr(db, "_conn", conn)
    yield
    conn.close()


def _patch(path: str = "src/app.py") -> str:
    return (
        f"diff --git a/{path} b/{path}\n"
        f"--- a/{path}\n+++ b/{path}\n"
        "@@ -1 +1 @@\n-old\n+new\n"
    )


def test_model_response_parser_accepts_fenced_diff_and_removes_only_sentinels():
    parsed = generator._parse_response(
        "BEGIN_SUMMARY\nSafe fix\nEND_SUMMARY\nBEGIN_PATCH\n```diff\n"
        + _patch()
        + "*** End Patch\n```\nEND_PATCH"
    )

    assert parsed["summary"] == "Safe fix"
    assert parsed["patch"].startswith("diff --git")
    assert "*** End Patch" not in parsed["patch"]


def test_patch_validation_blocks_escape_and_workflow_changes():
    assert sandbox.patch_paths(_patch()) == ["src/app.py"]
    with pytest.raises(sandbox.FixLabError, match="escapes"):
        sandbox.patch_paths(_patch("../outside.py"))
    with pytest.raises(sandbox.FixLabError, match="protected"):
        sandbox.patch_paths(_patch(".github/workflows/release.yml"))


def test_container_verification_has_no_network_or_capabilities(monkeypatch, tmp_path):
    captured = {}

    def fake_run(command, **kwargs):
        if command[:3] == ["docker", "image", "inspect"]:
            return subprocess.CompletedProcess(command, 0, "sha256:test\n", "")
        captured["command"] = command
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(command, 0, "passed", "")

    monkeypatch.setattr(sandbox.subprocess, "run", fake_run)
    receipts = sandbox.verify_in_container(
        tmp_path, "fixlab-python:test", [["python", "-m", "pytest", "-q"]]
    )

    command = captured["command"]
    assert command[command.index("--network") + 1] == "none"
    assert command[command.index("--cap-drop") + 1] == "ALL"
    assert "--read-only" in command
    assert command[command.index("--pull") + 1] == "never"
    assert captured["kwargs"]["shell"] is False
    assert receipts[0]["containerized"] is True
    assert receipts[0]["network_disabled"] is True
    assert receipts[0]["image_digest"] == "sha256:test"


def test_container_verification_fails_closed_when_trusted_image_is_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(
        sandbox.subprocess,
        "run",
        lambda command, **_kwargs: subprocess.CompletedProcess(command, 1, "", "missing"),
    )

    with pytest.raises(sandbox.FixLabError, match="trusted Fix Lab image"):
        sandbox.verify_in_container(tmp_path, "missing:image", [["python", "-m", "pytest"]])


def test_python_verification_avoids_collecting_source_modules_named_test(tmp_path):
    (tmp_path / "tests").mkdir()

    image, commands = sandbox.verification_commands(tmp_path, ["agents/test_writer.py"])

    assert image == "repoguardian-fixlab-python:local"
    assert commands == [[
        "python", "-m", "pytest", "tests", "-q", "-p", "no:cacheprovider"
    ]]


def test_fix_run_decision_is_single_use(fix_db):
    repo.create_investigation("inv", "owner/repo", "issue", 4, "Bug")
    created = repo.create_fix_run("fix", "inv", "owner/repo", 4)
    assert created["status"] == "queued"
    repo.update_fix_run(
        "fix", "proposed", summary="Fix", patch_diff=_patch(), commands=[], receipts=[]
    )

    decided = repo.decide_fix_run("fix", True, "maintainer")

    assert decided["status"] == "approved"
    assert repo.decide_fix_run("fix", False, "maintainer") is None


def test_interrupted_fix_runs_are_failed_on_restart(fix_db):
    repo.create_investigation("inv", "owner/repo", "issue", 4, "Bug")
    repo.create_fix_run("fix", "inv", "owner/repo", 4)
    repo.update_fix_run("fix", "generating")

    assert repo.fail_interrupted_fix_runs() == 1
    assert repo.get_fix_run("fix")["status"] == "failed"
    assert "backend restart" in repo.get_fix_run("fix")["error"]


def test_service_proposes_only_after_all_container_checks_pass(monkeypatch):
    state = {
        "id": "fix",
        "investigation_id": "inv",
        "repo_name": "owner/repo",
        "issue_number": 4,
    }
    updates = []
    monkeypatch.setattr(service.repo, "get_fix_run", lambda _id: state)
    monkeypatch.setattr(service, "candidate_paths", lambda _id: ["src/app.py"])
    monkeypatch.setattr(service, "prepare_checkout", lambda *_args: (Path("."), "abc"))
    monkeypatch.setattr(service, "generate_patch", lambda *_args: {"summary": "Fix", "patch": _patch()})
    monkeypatch.setattr(service, "apply_patch", lambda *_args: ["src/app.py"])
    monkeypatch.setattr(service, "verification_commands", lambda *_args: ("image", [["python", "-m", "pytest"]]))
    monkeypatch.setattr(service, "verify_in_container", lambda *_args: [{
        "command": ["python", "-m", "pytest"], "exit_code": 0,
        "duration_ms": 1, "stdout": "ok", "stderr": "",
        "containerized": True, "network_disabled": True,
        "image": "image", "image_digest": "sha256:test",
    }])
    monkeypatch.setattr(
        service.repo,
        "update_fix_run",
        lambda run_id, status, **fields: updates.append((run_id, status, fields)),
    )

    asyncio.run(service.run_fix("fix"))

    assert [status for _, status, _ in updates] == [
        "preparing", "generating", "generating", "verifying", "proposed"
    ]
    assert updates[-1][2]["receipts"][0]["network_disabled"] is True
