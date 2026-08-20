# Doombot

**Agentic open-source maintainer assistant** — Codeissance 2026, PS-04.

Doombot investigates GitHub issues and pull requests the way a human triager would,
and — this is the point — **shows its work**: a live, streaming, step-by-step
reasoning trace that cites its evidence, escalates only what genuinely needs a
human, and asks before it acts.

Runs on **Groq `openai/gpt-oss-120b`** with **local MiniLM embeddings**. No
OpenAI, no API bill.

```
Issue arrives
  → investigation opens
  → project history searched via RAG
  → compared against similar issues
  → classified duplicate / regression / related / novel
  → completeness and security assessed
  → evidence-backed escalation decision
  → maintainer approves, rejects, or corrects
  → approved GitHub action performed
```

---

## Status

**The fixture phase is over.** Every API route reads SQLite, health is computed
from real GitHub data, and the dashboard reads every screen from the API.

Nothing is `Implemented` until it is merged to `main` and demonstrated end to
end. The folder `CLAUDE.md` files carry the full specification; each stream's
README says what is actually done.

| Feature | ID | Priority | Status |
|---|---|---|---|
| GitHub integration & monitoring | F01 | P0 | Implemented |
| Multi-step investigation trace | F02 | P0 | Implemented |
| Project-aware RAG | F03 | P0 | Implemented |
| Selective escalation | F04 | P0 | Implemented |
| Explainability & feedback | F05 | P0 | Implemented — feedback logged, does not alter behavior (a deliberate cut) |
| Duplicate & regression detection | F06 | P0 | Implemented |
| Security-sensitive detection | F07 | P1 | Implemented — layer-1 keyword matching |
| Approval-controlled labeling | F08 | P1 | Implemented — approval-gated |
| Incomplete-issue follow-up | F09 | P1 | Planned |
| Project-health analysis | F10 | P1 | Implemented — real 4-axis scoring |
| Weekly brief | F11 | P2 | Implemented — counts only, deliberately not an LLM call |
| MCP protocol server | F12 | P2 | Implemented — 16 tools registered (9 GitHub + 7 intelligence) |
| Web dashboard | F13 | P0 | Implemented |
| VS Code extension | F14 | P2 | Implemented |
| Issue relationship graph | F15 | Stretch | Implemented — live from `rag.graph` |
| Intelligent issue resolution | F16 | Stretch | Implemented — approval-gated |
| Adaptive repository learning | F17 | Stretch | Implemented — few-shot grounded in the repo's closed issues |
| MCP intelligence layer | F18 | Stretch | Implemented — 7 read-only tools expose Doombot's analysis |

**Working today:** the issue-triage graph (`issue_fetcher → duplicate_detector
→ resolver → security_scanner → impact_scorer → labeler → decider`), the
PR-review graph (`fetcher → reviewer → test_writer → summarizer`), a FastMCP
stdio server over PyGithub, Chroma + MiniLM indexing, all 13 REST endpoints
plus `/ws`, and the dashboard reading every screen from the API.

**Known gap:** F09 (incomplete-issue follow-up) is not built.

---

## Documentation

Read in this order. **Agents: `CLAUDE.md` first, always.**

| File | What it is |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **Agent operating manual — rules, ownership, git workflow** |
| [AGENTS.md](AGENTS.md) | Codex entry point |
| [docs/DESIGN.md](docs/DESIGN.md) | Design and scope source of truth — features, tokens, screens, safety |
| [docs/DESIGN-ADDENDUM.md](docs/DESIGN-ADDENDUM.md) | Implementation specifics — type scale, z-index, motion, severity, microcopy |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and why it's built this way |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Git, PRs, integration gates |
| [docs/FEATURES.md](docs/FEATURES.md) | Feature → owner → branch mapping, cut list |
| [docs/PLAN.md](docs/PLAN.md) | Hour-boxed schedule and demo script |
| [STRETCH_FEATURES.md](STRETCH_FEATURES.md) | F15 and F16 specifications |
| [docs/INTELLIGENCE.md](docs/INTELLIGENCE.md) | F17 adaptive learning, F18 MCP intelligence layer — specs, not yet built |
| [TECHSTACK.md](TECHSTACK.md) | Dependencies, env vars, install |

**Per-stream entry points** (what's done, what to watch out for):
[Stream A](api/README.md) · [Stream B](agents/README.md) ·
[Stream C](dashboard/README.md) · [Stream D](vscode-extension/README.md)

**Per-folder contracts** (binding specifications):
[agents/](agents/CLAUDE.md) · [rag/](rag/CLAUDE.md) ·
[mcp_server/](mcp_server/CLAUDE.md) · [memory/](memory/CLAUDE.md) ·
[api/](api/CLAUDE.md) · [dashboard/](dashboard/CLAUDE.md) ·
[vscode-extension/](vscode-extension/CLAUDE.md) · [scripts/](scripts/CLAUDE.md)

---

## Team

Four streams, exclusive file ownership. Details in [CLAUDE.md](CLAUDE.md) §5.

Each stream has a **README as its entry point** — start there, then read the
`CLAUDE.md` it points to. The README says what is done and what to watch out
for; the `CLAUDE.md` is the binding contract.

| Stream | Scope | Start here | Contract |
|---|---|---|---|
| **A** — Core & API | FastAPI, SQLite, MCP client, seed data | [api/README.md](api/README.md) | [api/](api/CLAUDE.md) · [memory/](memory/CLAUDE.md) |
| **B** — Agents & RAG | LangGraph, triage nodes, Chroma, GitHub tools | [agents/README.md](agents/README.md) | [agents/](agents/CLAUDE.md) · [rag/](rag/CLAUDE.md) · [mcp_server/](mcp_server/CLAUDE.md) |
| **C** — Frontend Core | Investigation trace, evidence, comparison | [dashboard/README.md](dashboard/README.md) | [dashboard/FRONTEND-C.md](dashboard/FRONTEND-C.md) |
| **D** — Shell & Extension | App shell, overview, escalations, health, VS Code | [vscode-extension/README.md](vscode-extension/README.md) | [dashboard/FRONTEND-D.md](dashboard/FRONTEND-D.md) · [vscode-extension/](vscode-extension/CLAUDE.md) |

**Ownership is exclusive** (root [CLAUDE.md](CLAUDE.md) §5). The one place two
streams share a folder is `dashboard/src/components/` — C owns `Chain*`,
`Evidence*`, `Investigation*`; D owns `Repo*`, `Escalation*`, `Activity*`.
Check before editing a component you did not write.

**Shared, change only by announcement:** `api/schemas.py`, `agents/state.py`,
`mcp_server/tool_names.py`, `requirements.txt`, `.env.example`.

---

## Layout

```
agents/           LangGraph nodes and graphs
  chain.py          @chain_step — streaming + persistence + replay
  orchestrator.py   PR-review graph
  triage_graph.py   issue-triage graph
  triage/           triage nodes, one per file
mcp_server/       MCP tools, PyGithub client, shared session
rag/              Chroma + MiniLM indexing and retrieval
memory/           SQLite schema and query helpers
api/              FastAPI routes, WebSocket hub, Pydantic contract
dashboard/        React + Vite + Tailwind + shadcn/ui
vscode-extension/ companion webview
scripts/          seed_demo.py — demo fallback data
docs/             design, architecture, workflow, features, plan
tests/            ad-hoc manual scripts (see tests/README.md)
```

---

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate                    # Windows
# source .venv/bin/activate               # macOS / Linux

pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt

cp .env.example .env                      # add GITHUB_TOKEN and GROQ_API_KEY
```

Python 3.14. Install torch CPU-only — the default CUDA build is ~2.4GB versus ~200MB.

## Run

```bash
python app.py                             # PR review, CLI
uvicorn api.main:app --reload --port 8000 # API + WebSocket
cd dashboard && npm run dev               # dashboard on :5173
```

## Verify

```bash
curl http://localhost:8000/api/health     # -> {"status":"ok"}
wscat -c ws://localhost:8000/ws           # live step events
python -m scripts.seed_demo               # demo fallback data
```

---

## Stack

Python 3.14 · LangGraph · Groq `openai/gpt-oss-120b` · MCP (FastMCP) ·
PyGithub · ChromaDB + `all-MiniLM-L6-v2` · FastAPI · SQLite ·
React + Vite + TypeScript + Tailwind + shadcn/ui · VS Code webview

Full detail and rationale in [TECHSTACK.md](TECHSTACK.md).

---

*Built for Codeissance 2026 — PS-04*
