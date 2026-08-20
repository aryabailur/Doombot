# Stream A — Core & API

**Owner: Person A.** FastAPI routes, the WebSocket hub, SQLite, the MCP client,
and seed data.

## Read before working here

| File | What |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | **Agent operating manual — read first, always** |
| [CLAUDE.md](CLAUDE.md) | **The contract for this folder — endpoints, WS protocol, schemas** |
| [../memory/CLAUDE.md](../memory/CLAUDE.md) | SQLite schema and query helpers |
| [../scripts/CLAUDE.md](../scripts/CLAUDE.md) | Seed data and operational scripts |
| [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | How the pieces fit and why |

## You own

```
api/                    routes, WebSocket hub, Pydantic contract
memory/                 SQLite schema and query helpers
mcp_server/client.py    MCP client session
mcp_server/tool_names.py  shared tool-name constants
scripts/                seed_demo.py and operational scripts
```

**Do not edit** `agents/`, `rag/`, `mcp_server/tools.py`,
`mcp_server/github_client.py` (Stream B), or anything under `dashboard/`
(Streams C and D). See root `CLAUDE.md` §5.

---

## The one thing to be careful about

`api/schemas.py` is **the** contract between backend and frontend, and it is
past the freeze (root `CLAUDE.md` §7). Frontend types in
`dashboard/src/lib/types.ts` are hand-mirrored from it — there is no codegen,
so drift is invisible until runtime.

If you must change it:

1. Announce it before writing the code.
2. Change `api/schemas.py` **and** `dashboard/src/lib/types.ts` in the same PR.
3. Title the PR `feat(api)!: ...` — the `!` marks it breaking.
4. Ping both frontend owners.

A drifted mirror is not hypothetical here: the VS Code extension's copy of
`InvestigationSummary` was missing `completed_at` and typed `status` as a bare
`string`, which hid a real bug where the tree spun forever on finished
investigations. Two mirrors, one contract — keep them in step.

Equally: **never hardcode an MCP tool name.** Import from
`mcp_server/tool_names.py`. Name drift caused 2 of the 8 prototype bugs.

---

## Current state

The fixture phase is **over** — every route reads SQLite, and health is
computed from real GitHub data.

| Endpoint | State |
|---|---|
| `GET /api/health` | Live — liveness probe, returns `{"status":"ok"}` |
| `GET /api/repos` | Live |
| `POST /api/repos/{owner}/{repo}/index` | Live |
| `GET /api/repos/{owner}/{repo}/health` | Live — real scoring, 4-axis breakdown |
| `POST /api/investigations` | Live — returns an id, runs the graph in the background |
| `GET /api/investigations` | Live |
| `GET /api/investigations/{id}` | Live — replays the chain from SQLite |
| `GET /api/escalations` | Live — joined to investigations for number/title |
| `POST /api/feedback` | Live — logged and displayed, does not alter agent behavior (a deliberate cut) |
| `GET /api/repos/{owner}/{repo}/graph` | Live |
| `GET /api/repos/{owner}/{repo}/code-graph` | Live — `lru_cache`d, invalidated on index |
| `GET /api/brief/{owner}/{repo}` | Live — counts only, deliberately not an LLM call |
| `WS /ws` | Live |

> **Two different "health" endpoints, and it matters.** `GET /api/health` is a
> liveness probe returning `{"status":"ok"}` — it has no score in it. The
> numeric score lives at `GET /api/repos/{owner}/{repo}/health`. Reaching for
> the first one when you want a number is an easy and silent mistake.

---

## Rule 7 — the boundary that matters most

**A graph node must never touch SQLite or the WebSocket hub.** Nodes return
`(patch, evidence)`; the `@chain_step` decorator in `agents/chain.py` does the
rest — streaming, persistence, and replay all come from that one mechanism.

From Stream A's side this means: `memory/` and `api/ws.py` are called by the
API runner and by `@chain_step`, never from inside a node. If you are adding a
helper that a node would want to import directly, that is the signal you are
about to break rule 7.

---

## Run

```bash
uvicorn api.main:app --reload --port 8000
```

## Verify

```bash
curl http://localhost:8000/api/health          # -> {"status":"ok"}
pytest tests/test_api_contract.py -v           # the A/C/D seam
python -m scripts.seed_demo                    # demo fallback data
```

`tests/test_api_contract.py` checks every shape in `api/CLAUDE.md` plus the
WebSocket envelope, and names the exact field that is wrong. Run it after any
schema-adjacent change — it is the cheapest way to catch a drifted mirror.

## Definition of done

Root `CLAUDE.md` §9 applies in full. In particular: the verification command
above runs clean and its output goes in the PR, and if `api/schemas.py` moved,
`dashboard/src/lib/types.ts` moved with it in the same PR.
