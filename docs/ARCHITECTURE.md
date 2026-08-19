# Architecture

How Doombot is put together, and why.

Read `CLAUDE.md` first for the rules. This file explains the design.

---

## 1. The one idea

Everything in Doombot exists to make **agent reasoning visible and trustworthy**.

A conventional AI triage bot posts a verdict. Doombot streams its investigation
step by step — which tool it called, what it retrieved, how confident it is, and
which evidence supports the conclusion — and asks a human before acting.

That single requirement drives the whole architecture: the `@chain_step`
decorator, the WebSocket layer, the SQLite replay, and the evidence-first UI.

---

## 2. System map

```
                            ┌──────────────────────────────┐
                            │   Dashboard (React + Vite)   │
                            │   VS Code extension (webview)│
                            └──────────┬───────────────────┘
                                REST   │   WebSocket
                                       ▼
                            ┌──────────────────────────────┐
                            │  api/  FastAPI               │
                            │  routes · ws hub · schemas   │
                            └──────────┬───────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
         ┌───────────────┐   ┌──────────────┐   ┌──────────────┐
         │  agents/      │   │  memory/     │   │  rag/        │
         │  LangGraph    │   │  SQLite      │   │  Chroma +    │
         │  two graphs   │   │  persistence │   │  MiniLM      │
         └───────┬───────┘   └──────────────┘   └──────────────┘
                 │
                 ▼
         ┌──────────────────────────┐
         │  mcp_server/  MCP tools  │
         │  PyGithub → GitHub API   │
         └──────────────────────────┘
                 │
                 ▼            ┌─────────────┐
            GitHub API        │  Groq LLM   │  openai/gpt-oss-120b
                              └─────────────┘
```

---

## 3. The chain — the load-bearing mechanism

Every LangGraph node is wrapped by `@chain_step` from `agents/chain.py`. The
decorator times the node, catches its errors, builds a `StepRecord`, and emits it
to LangGraph's custom stream.

```
node returns (patch, evidence)
        │
   @chain_step ── builds StepRecord ── times it ── catches errors
        │
   get_stream_writer()
        │
   astream(stream_mode=["custom", "updates"])
        │
   ┌────┴────────────────────────┐
   ▼                             ▼
memory/repo.insert_step()   api/ws.broadcast()
   (persist)                   (live)
   │                             │
   ▼                             ▼
SQLite chain_steps          Dashboard timeline
   │
   └── GET /api/investigations/{id} replays it after a refresh
```

**One code path, three properties:**

| Property | How |
|---|---|
| **Live** | Custom stream → WebSocket → animated timeline |
| **Durable** | Same record written to `chain_steps` |
| **Replayable** | REST rebuilds the chain from SQLite |

Replay is why the demo survives a page refresh or an API restart in front of
judges. It's ~45 minutes of work that removes an entire class of demo failure.

**The boundary this creates:** a node never imports `memory/` or `api/`. It returns
`(patch, evidence)` and stays ignorant of persistence and transport. If you find
yourself importing `memory` inside `agents/`, you've taken a wrong turn.

---

## 4. Two graphs, one state

`agents/orchestrator.py` holds the existing PR-review graph. `agents/triage_graph.py`
holds the new issue-triage graph. Both share `GraphState`.

```
PR review (existing, preserved)
  START → fetcher → reviewer → test_writer → summarizer → END

Issue triage (new)
  START → issue_fetcher → duplicate_detector → security_scanner
        → impact_scorer → labeler → decider → END
```

**Why two graphs rather than one with a conditional branch:** a branch forces every
state field to be optional for both paths, and the node sets are genuinely
disjoint — nothing in triage touches a diff. Two graphs over one `TypedDict` gives
code reuse without `if` spaghetti, and lets Stream B build triage without touching
a working demo path.

---

## 5. Data flow of one investigation

```
1. POST /api/investigations {repo_name, kind, number}
2. API creates the row, returns investigation_id immediately, runs the graph
   as a background task
3. issue_fetcher    → MCP → PyGithub → GitHub          ─┐
4. duplicate_detector → Chroma {repo}-issues            │  each node emits
5. security_scanner → keyword pass (+ optional LLM)     │  a StepRecord to
6. impact_scorer    → engagement signals                │  the custom stream
7. labeler          → Groq classification               │
8. decider          → escalate | comment | close | none ─┘
9. Approved side effects → MCP → GitHub (comment, labels)
10. Health score recomputed and appended to the time series
```

Steps 3–8 stream to the dashboard as they happen. Step 9 requires human approval
per the autonomy policy in `docs/DESIGN.md` §12.

---

## 6. RAG design

Two Chroma collections per repository:

| Collection | Contents | Chunked? |
|---|---|---|
| `{repo}-code` | Repository files | Yes — 500 chars, 50 overlap |
| `{repo}-issues` | One document per issue | **No** |

**Issues are never chunked.** Duplicate detection compares whole issues; chunking
would compare fragments and destroy the signal. This is the highest-value rule in
the RAG layer.

Deterministic IDs (`issue-{n}`) make indexing idempotent — Chroma upserts, so
re-running is cheap and safe.

Thresholds: **>0.85 duplicate**, **0.65–0.85 related**. Use
`similarity_search_with_relevance_scores` (normalized, higher is better), never
`similarity_search_with_score` (L2 distance, lower is better) — inverting that is a
classic silent bug.

**The trap that breaks demos:** exclude the issue's own number from results, or
every issue is its own perfect duplicate.

---

## 7. MCP layer

GitHub access is wrapped as MCP tools, so tool use is inspectable rather than
buried in Python calls.

Two modes behind one `call(name, args)` interface:

| `USE_MCP_SUBPROCESS` | Behavior | When |
|---|---|---|
| `0` (default) | Direct dispatch to `github_client` | Always, including the demo |
| `1` | Real stdio session, `python -m mcp_server.server` | Proving the MCP surface |

The prototype spawned three subprocesses per run, each re-importing torch and
chromadb. Mode 0 removes that cost and the associated failure modes while keeping
`server.py` alive as a genuine, inspectable MCP server.

Tool names are constants in `mcp_server/tool_names.py`. Never a string literal —
name drift caused two of the eight prototype bugs.

---

## 8. Frontend

The dashboard is the primary product surface (F13). The VS Code extension is a
companion (F14, P2), not a second application.

```
dashboard/src/
  lib/         api client, hand-mirrored types, WebSocket hook   ← Stream C
  components/
    Investigation* Evidence* SimilarIssue* Confidence* Approval* ← Stream C
    AppShell* Repo* Agent* Health* Escalation* Severity*         ← Stream D
    Empty* Error* Skeleton*                                      ← Stream D (shared)
  App.tsx                                                        ← Stream D
```

**WebSocket is a live overlay; REST is the source of truth.** On reconnect, the UI
refetches investigation detail over REST rather than trusting that it saw every
event. Events can be missed while disconnected; SQLite cannot.

---

## 9. What we deliberately did not build

| Not built | Why |
|---|---|
| Webhook receiver | Needs ngrok and a public URL; fails on venue wifi. A button hits the identical code path. |
| Polling/cron loop | A judge cannot see a background timer. |
| Postgres, Redis, Celery | SQLite and FastAPI background tasks are sufficient at this scale. |
| aiosqlite | Writes are sub-millisecond; one less dependency. |
| Codegen for TS types | Hand-mirrored, enforced by a same-PR rule. Codegen costs more setup than it saves in 30 hours. |
| Docker sandbox, AST analysis, toxicity scoring | Out of MVP scope — `docs/DESIGN.md` §3. |

Each of these is a deliberate trade, not an oversight. If you're about to add one,
read the reason first.

---

## 10. Where to go next

| You are working on | Read |
|---|---|
| Graphs, nodes, the chain | `agents/CLAUDE.md` |
| Indexing, retrieval, duplicates | `rag/CLAUDE.md` |
| GitHub tools, MCP | `mcp_server/CLAUDE.md` |
| SQLite | `memory/CLAUDE.md` |
| Endpoints, WebSocket | `api/CLAUDE.md` |
| Any frontend work | `dashboard/CLAUDE.md`, then your `FRONTEND-*.md` |
| The extension | `vscode-extension/CLAUDE.md` |
| Design, tokens, screens, safety | `docs/DESIGN.md` |
| Type scale, z-index, motion, severity | `docs/DESIGN-ADDENDUM.md` |
| Who builds what, in what order | `docs/FEATURES.md`, `docs/WORKFLOW.md` |
