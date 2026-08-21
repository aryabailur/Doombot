# api/ — FastAPI backend, the contract with the frontend

**Owner:** Person A (Stream A) · **Branch prefix:** `feat/a-<slug>`

Read the root `CLAUDE.md` first. This file governs everything under `api/`.

---

## 1. Purpose

`api/` is the FastAPI app: HTTP routes, the WebSocket hub, and the graph
runner that bridges LangGraph output into both SQLite and the socket.

## 2. The contract freeze — read this before touching `schemas.py`

`api/schemas.py` is **the** interface between backend and frontend. Nothing
else in this repo is more load-bearing.

**The rule:** ship every endpoint returning **hardcoded fixtures** that match
the Pydantic models in `schemas.py`, before writing a single line of real
logic (RAG calls, LangGraph runs, SQLite queries). Person C and Person D build
their frontend against real HTTP responses from hour one. If you wait for
real logic before returning a shape, you have blocked two other people.

Freeze sequence:
1. Write every model in `schemas.py`.
2. Write every route returning a fixture instance of the right model.
3. Announce "contract frozen" to the team.
4. Only then start replacing fixtures with real logic, endpoint by endpoint.

**Changing `schemas.py` after the freeze** is a breaking change. You must:
1. Announce it to the team before writing the code.
2. Change `api/schemas.py` **and** `dashboard/src/lib/types.ts` in the **same PR**.
3. Title the PR `feat(api)!: ...` — the `!` marks it breaking.
4. Ping both frontend owners (C and D) on the PR.

There is no codegen. Frontend types are hand-mirrored from `schemas.py`. If
you skip step 2, the frontend silently drifts and nobody notices until a
demo-day crash.

---

## 3. Endpoint table

| Method | Path | Request body | Response shape | Owner | Notes |
|---|---|---|---|---|---|
| GET | `/api/health` | — | `{status: "ok"}` | A | Liveness only, no DB touch |
| GET | `/api/repos` | — | `[RepoSummary]` | A | `{repo_name, health_score, open_investigations, last_scan}` |
| POST | `/api/repos/{owner}/{repo}/index` | — | `IndexJobResponse` | A | Ensures bounded code + issue indexing; returns `ready` or an async job |
| GET | `/api/index-jobs/{id}` | — | `IndexJobResponse` | A | In-process status: `queued`, `running`, `done`, `ready`, or `error` |
| GET | `/api/repos/{owner}/{repo}/health` | — | `HealthResponse` | A | `{score, breakdown, history, measured, issue_count}`; `measured: false` means no issues to score — render `--`, not the number |
| POST | `/api/investigations` | `CreateInvestigationRequest` | `{investigation_id: str}` | A | `{repo_name, kind: "issue"|"pr", number}`; runs graph in background |
| GET | `/api/investigations` | — | `[InvestigationSummary]` | A | List, newest first; `?repo_name=` scopes to one repo |
| GET | `/api/investigations/{id}` | — | `InvestigationDetail` | A | Detail + `steps[]` and nullable `proposed_action`, replayed from SQLite |
| GET | `/api/escalations` | — | `[Escalation]` | A | `{investigation_id, reason, severity, number, title, created_at}`; `?repo_name=` scopes to one repo |
| GET | `/api/actions` | — | `[ProposedAction]` | A | Auditable action queue; optional `?repo_name=` and `?status=` filters |
| GET | `/api/actions/{id}` | — | `ProposedAction` | A | Exact comment/labels, decision, execution receipt, and timestamps |
| POST | `/api/actions/{id}/decision` | `ActionDecisionRequest` | `ProposedAction` | A | Atomically approve/reject; approval executes once unless `DEMO_MODE=1` |
| POST | `/api/fix-runs` | `CreateFixRunRequest` | `FixRun` | A | Explicitly generate and container-verify a patch grounded in a completed code-aware investigation |
| GET | `/api/fix-runs/{id}` | — | `FixRun` | A | Persisted lifecycle, diff, commands, and verification receipts |
| POST | `/api/fix-runs/{id}/decision` | `FixDecisionRequest` | `FixRun` | A | Single-use review; approval does not publish a branch or PR |
| GET | `/api/policy` | — | `RepositoryPolicy` | A | `?repo_name=`; decision-derived action/label preferences, sample counts, and guidance |
| POST | `/api/repos/{owner}/{repo}/scan` | — | `{repo_name, queued[], skipped_already_investigated}` | A | Investigates open issues, `?limit=` 1–25 (default 5); 502 if the repo cannot be read |
| POST | `/api/feedback` | `FeedbackRequest` | `{ok: true}` | A | Free-form usefulness feedback is logged; action approvals/rejections also feed `RepositoryPolicy` |
| GET | `/api/brief/{owner}/{repo}` | — | `BriefResponse` | A | `{markdown, generated_at}` |
| WS | `/ws` | — | event envelope stream | A | See §5 |

Routes live in `api/routes_repos.py` (health/repos/index/brief),
`api/routes_investigations.py` (investigations/escalations/graph runner),
`api/routes_feedback.py` (feedback). `api/ws.py` owns the socket hub.
`api/main.py` wires routers, CORS, and startup/shutdown.

---

## 4. The `StepRecord` shape — identical everywhere

The same JSON shape is used in the `chain_steps` SQLite table, on the
WebSocket, and in the REST detail response. Define it **once**, in
`schemas.py`, and reuse it everywhere. Do not let a second, slightly
different shape grow anywhere else.

```python
class StepRecord(BaseModel):
    step_id: str
    investigation_id: str
    seq: int
    name: str
    title: str
    status: Literal["running", "done", "error"]
    input_summary: str
    output_summary: str
    evidence: list[Evidence]
    duration_ms: int
    started_at: str   # ISO 8601 UTC
    ended_at: str | None
```

---

## 5. Pydantic models to define in `schemas.py`

Exact field names and types — no others, no renames.

```python
class Evidence(BaseModel):
    # CLOSED union, not a bare str. These four are what the agent actually
    # emits (agents/CLAUDE.md 3.6). The earlier example comment here read
    # "duplicate", "security", "file" -- none of which the backend produces --
    # and Stream A's mocks were written against it, which the tightened
    # frontend type then rejected. Keep this list and agents/CLAUDE.md 3.6
    # identical.
    type: Literal["issue", "pr", "file", "rule"]
    ref: str              # issue/PR number, file path, or rule/keyword name
    # Nullable: rule-type evidence (a matched keyword, a threshold note) has no
    # meaningful score, and the backend sends null rather than a misleading 0.
    score: float | None
    snippet: str

class StepRecord(BaseModel):
    step_id: str
    investigation_id: str
    seq: int
    name: str
    title: str
    status: Literal["running", "done", "error"]
    input_summary: str
    output_summary: str
    evidence: list[Evidence]
    duration_ms: int
    started_at: str
    ended_at: str | None

class InvestigationSummary(BaseModel):
    investigation_id: str
    repo_name: str
    kind: Literal["issue", "pr"]
    number: int
    title: str
    status: str
    decision: str | None
    created_at: str
    completed_at: str | None

class InvestigationDetail(InvestigationSummary):
    steps: list[StepRecord]
    decision_reason: str | None
    confidence: float | None
    impact_score: float | None
    proposed_action: ProposedAction | None = None

class ProposedAction(BaseModel):
    id: str
    investigation_id: str
    repo_name: str
    issue_number: int
    action: str
    comment: str | None
    labels: list[str]
    status: Literal["proposed", "approved", "rejected", "executing", "verified", "failed"]
    decided_by: str | None
    decision_note: str | None
    result: dict | None
    error: str | None
    created_at: str
    decided_at: str | None
    executed_at: str | None

class Escalation(BaseModel):
    investigation_id: str
    reason: str
    severity: str          # e.g. "low" | "medium" | "high"
    number: int
    title: str
    created_at: str

class HealthBreakdown(BaseModel):
    security: float
    staleness: float
    duplication: float
    responsiveness: float

class HealthPoint(BaseModel):
    ts: str
    score: float

class HealthResponse(BaseModel):
    score: float
    breakdown: HealthBreakdown
    history: list[HealthPoint]
    measured: bool = True      # False when the repo has no issues to score
    issue_count: int = 0
    unreadable: bool = False   # True when issues could not be read at all

class RepoSummary(BaseModel):
    repo_name: str
    health_score: float
    open_investigations: int
    last_scan: str | None

class CreateInvestigationRequest(BaseModel):
    repo_name: str
    kind: Literal["issue", "pr"]
    number: int

class FeedbackRequest(BaseModel):
    investigation_id: str
    step_id: str | None = None
    verdict: Literal["up", "down"]
    note: str | None = None

class ActionDecisionRequest(BaseModel):
    approved: bool
    decided_by: str
    note: str | None = None

class ActionPolicyProfile(BaseModel):
    action: str
    samples: int
    approvals: int
    rejections: int
    approval_rate: float
    guidance: Literal["observing", "caution", "mixed", "aligned"]

class LabelPolicyProfile(BaseModel):
    label: str
    samples: int
    approvals: int
    rejections: int
    approval_rate: float
    guidance: Literal["observing", "caution", "mixed", "aligned"]

class RepositoryPolicy(BaseModel):
    repo_name: str
    mode: Literal["observing", "learned"]
    minimum_samples: int
    total_decisions: int
    approvals: int
    rejections: int
    approval_rate: float | None
    actions: list[ActionPolicyProfile]
    labels: list[LabelPolicyProfile]
    learned_rules: list[str]
    updated_at: str | None

class BriefResponse(BaseModel):
    markdown: str
    generated_at: str

class IndexJobResponse(BaseModel):
    job_id: str
    status: str
```

---

## 6. WebSocket protocol

Single `/ws` endpoint. Backed by a **module-level `set[WebSocket]`** hub in
`api/ws.py`. No rooms, no auth: every connected client receives every event,
and filters client-side by `investigation_id`.

**This is correct at demo scale.** Building per-investigation rooms or
connection auth for a hackathon judged over a few dozen events saves nobody
anything and costs you an hour you don't have. Do not "fix" this without a
real reason.

Signatures:

```python
async def broadcast(event: dict) -> None:
    """Send `event` (already an envelope dict) to every connected client.
    Drop dead sockets silently; never let one broken client take down the loop."""

async def websocket_endpoint(ws: WebSocket) -> None:
    """Accept, register in the hub set, then loop reading (and discarding)
    client messages until disconnect, at which point deregister."""
```

**Event envelope:** `{type: str, data: dict}`

Event types:

| type | data shape |
|---|---|
| `step.started` | `StepRecord` (status `"running"`) |
| `step.completed` | `StepRecord` (status `"done"` or `"error"`) |
| `investigation.completed` | `{investigation_id, decision, health_delta}` |
| `activity` | `{ts, repo_name, message, severity}` |

**Reconnect guidance for clients:** the socket carries no history. On
connect (or reconnect after a drop), a client must first call
`GET /api/investigations/{id}` (or `/api/investigations` for the activity
feed) to get current state, then apply live events on top. Never treat the
socket as the source of truth by itself — SQLite is the source of truth,
the socket is just the low-latency notification path.

---

## 7. The graph runner — `routes_investigations.py`

The `POST /api/investigations` handler kicks off a LangGraph run in the
background and streams its output through one loop that does three jobs at
once:

```python
async for mode, chunk in issue_app.astream(init, stream_mode=["custom", "updates"]):
    if mode == "custom":
        repo.insert_step(chunk["data"])          # persistence
        await ws.broadcast(chunk)                # live streaming
    # "updates" mode chunks are used to detect terminal state / decision
```

This single code path is why the chain is simultaneously:
- **live** — every step reaches the browser the instant `agents/chain.py`'s
  `@chain_step` decorator emits it,
- **persisted** — the same record lands in `chain_steps` before or alongside
  the broadcast, and
- **replay-proof** — `GET /api/investigations/{id}` rebuilds the exact same
  `steps[]` from SQLite, so a page refresh or an API restart mid-demo does
  not lose the chain.

Do not add a second path that writes steps only to the socket or only to the
DB. If you find yourself doing that, you've broken replay or you've broken
live-streaming — the whole point is one write site for both.

---

## 8. Health score formula

`score` is 0–100, a weighted sum of four sub-scores, each independently
0–100:

```python
# Tunable constants — top of api/routes_repos.py (or a small scoring module)
WEIGHT_SECURITY = 0.35
WEIGHT_STALENESS = 0.25
WEIGHT_DUPLICATION = 0.15
WEIGHT_RESPONSIVENESS = 0.25

score = (
    WEIGHT_SECURITY * security
    + WEIGHT_STALENESS * staleness
    + WEIGHT_DUPLICATION * duplication
    + WEIGHT_RESPONSIVENESS * responsiveness
)
```

These weights are a starting point, not gospel — they are constants at the
top of the module specifically so they can be retuned in one place during
demo prep without touching call sites.

---

## 9. CORS

The dashboard runs on Vite at `http://localhost:5173`. The VS Code
extension's webview has its own origin (`vscode-webview://...`). Both must
be allowed in `api/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "vscode-webview://*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

If the webview origin pattern doesn't match with a wildcard in your
`CORSMiddleware` version, allow-list the exact origin string VS Code reports
at runtime rather than disabling CORS checks entirely.

---

## 10. Startup / shutdown

`api/main.py`'s FastAPI lifespan (or `@app.on_event`) must, in order:

**Startup:**
1. `memory.db.init_db()` — creates tables if missing.
2. `mcp_server.client.startup()` — brings up the MCP client (subprocess or
   direct-dispatch mode; see `mcp_server/CLAUDE.md`).

**Shutdown:**
1. `mcp_server.client.shutdown()`.

---

## 11. Files allowlist

You may create or edit:
- `api/__init__.py`
- `api/main.py`
- `api/schemas.py`
- `api/ws.py`
- `api/routes_investigations.py`
- `api/routes_repos.py`
- `api/routes_feedback.py`

**Do not touch:** `agents/`, `rag/`, `dashboard/`, `vscode-extension/`,
`mcp_server/github_client.py`, `mcp_server/tools.py`. If a route needs
something from `agents/` or `rag/`, import their public functions — do not
edit those modules.

---

## 12. Verification

Start the server:

```bash
uvicorn api.main:app --reload --port 8000
```

Exercise every endpoint:

```bash
curl http://localhost:8000/api/health

curl http://localhost:8000/api/repos

curl -X POST http://localhost:8000/api/repos/octocat/Hello-World/index

curl http://localhost:8000/api/repos/octocat/Hello-World/health

curl -X POST http://localhost:8000/api/investigations \
  -H "Content-Type: application/json" \
  -d '{"repo_name": "octocat/Hello-World", "kind": "issue", "number": 1}'

curl http://localhost:8000/api/investigations

curl http://localhost:8000/api/investigations/<investigation_id>

curl http://localhost:8000/api/escalations

curl -X POST http://localhost:8000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"investigation_id": "<id>", "verdict": "up"}'

curl http://localhost:8000/api/brief/octocat/Hello-World
```

Socket, with `wscat` (`npm i -g wscat`):

```bash
wscat -c ws://localhost:8000/ws
# then, from another terminal, POST an investigation and watch
# step.started / step.completed / investigation.completed events arrive
```

---

## 13. Task breakdown

| Task | File(s) | Branch |
|---|---|---|
| Define all Pydantic models | `api/schemas.py` | `feat/a-api-schemas` |
| Fixture routes for repos/health/brief | `api/routes_repos.py` | `feat/a-api-repos-fixtures` |
| Fixture routes for investigations/escalations | `api/routes_investigations.py` | `feat/a-api-investigations-fixtures` |
| Feedback route | `api/routes_feedback.py` | `feat/a-api-feedback` |
| WebSocket hub | `api/ws.py` | `feat/a-api-ws-hub` |
| App wiring: CORS, startup/shutdown, routers | `api/main.py` | `feat/a-api-main` |
| Replace fixtures with real graph runner | `api/routes_investigations.py` | `feat/a-api-graph-runner` |
| Replace fixtures with real health scoring | `api/routes_repos.py` | `feat/a-api-health-scoring` |

---

## Definition of done

- [ ] Every model in §5 exists in `schemas.py` with exact field names/types
- [ ] Every endpoint in the table returns the documented shape (fixture or real)
- [ ] `StepRecord` is defined once and reused by DB, WS, and REST
- [ ] WebSocket hub is a single module-level `set[WebSocket]`, no rooms, no auth
- [ ] Graph runner loop fans each custom chunk to both `repo.insert_step()` and `ws.broadcast()`
- [ ] Health score weights are named constants at the top of the module
- [ ] CORS allows `http://localhost:5173` and the vscode webview origin
- [ ] `init_db()` and `mcp_server.client.startup()` run on startup
- [ ] Every curl command above returns 200 with the documented shape
- [ ] `wscat` connection receives at least one event during a live investigation run
- [ ] Any change to `schemas.py` after freeze followed the 4-step breaking-change process

---

## 14. Stretch endpoints (F15, F16)

### `GET /api/repos/{owner}/{repo}/graph`

Returns the issue relationship graph for the force-directed view.

```python
class GraphNode(BaseModel):
    id: str                # "issue-412"
    number: int
    title: str
    category: Literal["security", "duplicate", "stale", "resolved", "open"]
    state: str
    labels: list[str]
    engagement: int        # reactions + comments
    escalated: bool

class GraphLink(BaseModel):
    source: str            # node id
    target: str
    kind: Literal["duplicate", "similar", "reference", "metadata"]
    score: float
    why: str               # human-readable reason, rendered on click

class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    links: list[GraphLink]
    stats: dict
```

**The computation already exists** — `rag.graph.build_graph(repo_name,
security_numbers)` returns exactly this shape. The route is a thin wrapper:
read the escalated issue numbers from SQLite for `security_numbers`, call it,
return it. Do not recompute relationships in the API layer.

Returns empty lists rather than 404 for an unindexed repo, so the dashboard
renders an empty state rather than an error.

### `resolution` on `InvestigationDetail`

F16 adds one nullable field to the detail response:

```python
class Resolution(BaseModel):
    source_issue: int
    source_title: str
    similarity: float
    reply: str
    confidence: float
    reason: str
    auto_post: bool        # was it eligible to post without approval
    posted: bool

# InvestigationDetail gains:
    resolution: Resolution | None
```

Persist it alongside the decision. When `auto_post` is false and `posted` is
false, the dashboard shows the draft with an approve action -- that is the
approval gate, and it is the default path.
