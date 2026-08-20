"""Contract tests for the API surface.

These check a *running* API against the shapes documented in
`api/CLAUDE.md` -- field names, types, and nullability. They are the seam
where Stream A meets Streams C and D, and that seam is where the remaining
integration risk lives: three people mirrored the same spec by hand, and
nothing so far has compared their work against it mechanically.

The failure mode this exists to catch is silent. If the API returns `id`
where the frontend reads `investigation_id`, nothing raises -- React renders
`undefined`, the dashboard looks empty, and every individual test still
passes. The WebSocket envelope mismatch already found in this project
(`{type, step}` versus `{type, data}`) was exactly this shape of bug.

Usage:
    uvicorn api.main:app --port 8000     # in another terminal
    pytest tests/test_api_contract.py -v

Every test skips cleanly when the API is not running, so this file is safe
to leave in the default `pytest tests/` run.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import pytest

BASE_URL = os.getenv("DOOMBOT_API_URL", "http://localhost:8000")
# Generous because /api/repos/{owner}/{repo}/health computes from live GitHub
# on a cold cache -- measured at ~9s listing 100 issues. A 5s timeout made this
# suite fail intermittently depending only on whether the API had been asked
# recently, which is the worst kind of flake: it looks like a real regression.
TIMEOUT = 30

# --- documented shapes, transcribed from api/CLAUDE.md -----------------------
# (field name -> accepted python types). `None` in a tuple means nullable.

EVIDENCE_TYPES = {"issue", "pr", "file", "rule"}

EVIDENCE = {
    "type": (str,),
    "ref": (str,),
    "score": (float, int, type(None)),
    "snippet": (str,),
}

STEP_RECORD = {
    "step_id": (str,),
    "investigation_id": (str,),
    "seq": (int,),
    "name": (str,),
    "title": (str,),
    "status": (str,),
    "input_summary": (str,),
    "output_summary": (str,),
    "evidence": (list,),
    "duration_ms": (int,),
    "started_at": (str,),
    "ended_at": (str, type(None)),
}

INVESTIGATION_SUMMARY = {
    "investigation_id": (str,),
    "repo_name": (str,),
    "kind": (str,),
    "number": (int,),
    "title": (str,),
    "status": (str,),
    "decision": (str, type(None)),
    "created_at": (str,),
    "completed_at": (str, type(None)),
}

INVESTIGATION_DETAIL = {
    **INVESTIGATION_SUMMARY,
    "steps": (list,),
    "decision_reason": (str, type(None)),
    "confidence": (float, int, type(None)),
    "impact_score": (float, int, type(None)),
}

ESCALATION = {
    "investigation_id": (str,),
    "reason": (str,),
    "severity": (str,),
    "number": (int,),
    "title": (str,),
    "created_at": (str,),
}

HEALTH_BREAKDOWN = {
    "security": (float, int),
    "staleness": (float, int),
    "duplication": (float, int),
    "responsiveness": (float, int),
}

HEALTH_RESPONSE = {
    "score": (float, int),
    "breakdown": (dict,),
    "history": (list,),
    # False when the repository has no issues to measure. Three of the four
    # sub-scores return 100 for an empty backlog, so without this an unread
    # repository reported a confident 100/100.
    "measured": (bool,),
    "issue_count": (int,),
}

REPO_SUMMARY = {
    "repo_name": (str,),
    "health_score": (float, int),
    "open_investigations": (int,),
    "last_scan": (str, type(None)),
}

STEP_STATUSES = {"running", "done", "error"}
WS_EVENT_TYPES = {
    "step.started",
    "step.completed",
    "investigation.completed",
    "activity",
}


# --- helpers ----------------------------------------------------------------


def _get(path: str):
    """GET a path. Returns (status, body); status is None if unreachable.

    HTTPError is caught BEFORE URLError. HTTPError subclasses URLError, so
    the broader clause first would swallow every 4xx/5xx into "unreachable"
    and make status-code assertions silently unfalsifiable -- which is
    exactly what happened here: test_unknown_investigation_returns_404 read
    None from a server that was correctly returning 404.
    """
    try:
        with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=TIMEOUT) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return None, None


_api_up: bool | None = None


def _require_api():
    """Skip the whole module cheaply when the API is down.

    The probe result is cached: without this, every test pays a fresh
    connection timeout and the suite takes ~30s to report that nothing is
    running, which is slow enough that people stop running it.
    """
    global _api_up
    if _api_up is None:
        status, _ = _get("/api/health")
        _api_up = status is not None
    if not _api_up:
        pytest.skip(f"API not running at {BASE_URL}")


def assert_shape(obj: dict, spec: dict, label: str) -> None:
    """Assert `obj` has exactly `spec`'s keys, with the documented types.

    Extra keys are reported too, not just missing ones. An undocumented field
    is how the frontend and backend drift apart -- one side starts relying on
    something the spec never promised.
    """
    assert isinstance(obj, dict), f"{label}: expected an object, got {type(obj).__name__}"

    missing = sorted(set(spec) - set(obj))
    extra = sorted(set(obj) - set(spec))
    assert not missing, f"{label}: missing documented fields {missing}"
    assert not extra, (
        f"{label}: undocumented fields {extra} -- either add them to "
        f"api/CLAUDE.md or remove them from the response"
    )

    for field, types in spec.items():
        assert isinstance(obj[field], types), (
            f"{label}.{field}: expected {[t.__name__ for t in types]}, "
            f"got {type(obj[field]).__name__} ({obj[field]!r})"
        )


# --- tests ------------------------------------------------------------------


def test_health_endpoint():
    _require_api()
    status, body = _get("/api/health")
    assert status == 200
    assert body == {"status": "ok"}, f"expected {{'status': 'ok'}}, got {body}"


def test_repos_shape():
    _require_api()
    status, body = _get("/api/repos")
    assert status == 200
    assert isinstance(body, list), "/api/repos must return a list"
    for index, repo in enumerate(body):
        assert_shape(repo, REPO_SUMMARY, f"RepoSummary[{index}]")


def test_investigations_list_shape():
    _require_api()
    status, body = _get("/api/investigations")
    assert status == 200
    assert isinstance(body, list), "/api/investigations must return a list"
    for index, item in enumerate(body):
        assert_shape(item, INVESTIGATION_SUMMARY, f"InvestigationSummary[{index}]")
        assert item["kind"] in {"issue", "pr"}, f"kind was {item['kind']!r}"


def test_investigation_detail_and_steps():
    """The hero path: detail must replay its chain from SQLite."""
    _require_api()
    _, listing = _get("/api/investigations")
    if not listing:
        pytest.skip("no investigations to inspect")

    ident = listing[0]["investigation_id"]
    status, detail = _get(f"/api/investigations/{ident}")
    assert status == 200
    assert_shape(detail, INVESTIGATION_DETAIL, "InvestigationDetail")

    for index, step in enumerate(detail["steps"]):
        assert_shape(step, STEP_RECORD, f"StepRecord[{index}]")
        assert step["status"] in STEP_STATUSES, f"status was {step['status']!r}"
        for e_index, evidence in enumerate(step["evidence"]):
            assert_shape(evidence, EVIDENCE, f"StepRecord[{index}].evidence[{e_index}]")

    # Ordering is load-bearing: the trace renders in seq order, so a shuffled
    # replay would silently show the investigation out of sequence.
    seqs = [step["seq"] for step in detail["steps"]]
    assert seqs == sorted(seqs), f"steps not ordered by seq: {seqs}"


def test_escalations_shape():
    _require_api()
    status, body = _get("/api/escalations")
    assert status == 200
    assert isinstance(body, list), "/api/escalations must return a list"
    for index, item in enumerate(body):
        assert_shape(item, ESCALATION, f"Escalation[{index}]")


def _liveliest_repo(repos: list[dict]) -> str:
    """The repo most likely to be warm in the health cache."""
    ranked = sorted(
        repos,
        key=lambda r: (r.get("last_scan") or "", r.get("health_score") or 0),
        reverse=True,
    )
    return ranked[0]["repo_name"]


def test_health_response_shape():
    _require_api()
    _, repos = _get("/api/repos")
    if not repos:
        pytest.skip("no repos to query health for")

    # Query the repository with the most recorded activity rather than
    # whichever happens to sort first. Health is computed live from GitHub, so
    # a repo the agent has barely touched means a cold multi-second fetch --
    # and if GitHub has applied a secondary rate limit, PyGithub backs off for
    # minutes and the request cannot return inside any sane test timeout. That
    # is an environment condition, not a contract violation.
    status, body = _get(f"/api/repos/{_liveliest_repo(repos)}/health")
    if status is None:
        pytest.skip("health did not return in time (cold fetch or rate limit)")
    assert status == 200
    assert_shape(body, HEALTH_RESPONSE, "HealthResponse")
    assert_shape(body["breakdown"], HEALTH_BREAKDOWN, "HealthBreakdown")
    for index, point in enumerate(body["history"]):
        assert_shape(point, {"ts": (str,), "score": (float, int)}, f"HealthPoint[{index}]")


def test_unknown_investigation_returns_404():
    """A missing id must 404, not 200 with an empty object.

    The dashboard distinguishes "not found" from "found but empty"; a 200
    here would render a blank investigation instead of an error state.

    Was xfail during the fixture phase, when every route returned the same
    hardcoded object regardless of id. Now that the route reads SQLite this is
    a live assertion again -- which is exactly why it was left visibly xfail
    rather than deleted.
    """
    _require_api()
    status, _ = _get("/api/investigations/definitely-not-a-real-id")
    assert status == 404, f"expected 404, got {status}"


def test_frontend_mirror_matches_documented_shapes():
    """dashboard/src/lib/types.ts must mirror the documented shapes.

    No codegen exists, so the two are kept in step by hand (root CLAUDE.md
    §7). This compares them mechanically instead of trusting that.

    Runs without the API, so it protects the contract even when nobody has
    the backend up.
    """
    import pathlib
    import re

    types_file = pathlib.Path(__file__).parent.parent / "dashboard/src/lib/types.ts"
    if not types_file.exists():
        pytest.skip("dashboard types.ts not present")

    source = types_file.read_text(encoding="utf-8")

    def fields_of(interface: str) -> set[str]:
        match = re.search(
            rf"export interface {interface} \{{(.*?)\n\}}", source, re.DOTALL
        )
        if not match:
            return set()
        return set(re.findall(r"^\s*(\w+)\??:", match.group(1), re.MULTILINE))

    for interface, spec in (("StepRecord", STEP_RECORD), ("Evidence", EVIDENCE)):
        ts_fields = fields_of(interface)
        if not ts_fields:
            pytest.skip(f"{interface} not defined in types.ts yet")
        assert ts_fields == set(spec), (
            f"types.ts {interface} does not match api/CLAUDE.md: "
            f"missing {sorted(set(spec) - ts_fields)}, "
            f"extra {sorted(ts_fields - set(spec))}"
        )


# --- WebSocket ---------------------------------------------------------------


def test_websocket_envelope_and_step_shape():
    """Live events must be {type, data} with a full StepRecord inside.

    This coupling has already broken once: agents/chain.py emitted
    {type, step} while the contract and Stream C's useSocket guard both
    require {type, data}, so the dashboard silently dropped every event while
    the backend looked healthy. tests/test_chain.py locks the emitter side;
    this locks what actually arrives over the wire.

    Requires an investigation to be running, so it skips unless one produces
    events within the timeout.
    """
    _require_api()
    try:
        import asyncio

        import websockets
    except ImportError:  # pragma: no cover
        pytest.skip("websockets not installed")

    ws_url = BASE_URL.replace("http://", "ws://").replace("https://", "wss://") + "/ws"

    async def collect() -> list[dict]:
        received: list[dict] = []
        try:
            async with websockets.connect(ws_url, open_timeout=3) as socket:
                while len(received) < 4:
                    raw = await asyncio.wait_for(socket.recv(), timeout=4)
                    received.append(json.loads(raw))
        except Exception:
            pass
        return received

    events = asyncio.run(collect())
    if not events:
        pytest.skip("no WebSocket events observed (no investigation running)")

    for index, event in enumerate(events):
        assert set(event) == {"type", "data"}, (
            f"event[{index}]: envelope must be exactly {{type, data}}, got "
            f"{sorted(event)} -- Stream C's useSocket drops anything else"
        )
        assert event["type"] in WS_EVENT_TYPES, f"unknown type {event['type']!r}"

        if event["type"].startswith("step."):
            assert_shape(event["data"], STEP_RECORD, f"event[{index}].data")
