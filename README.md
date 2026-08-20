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

**Documentation and scaffolding complete. Implementation not started.**

Placeholder modules carry their contract in the docstring; the folder `CLAUDE.md`
files carry the full specification. Nothing below is `Implemented` until it is
merged to `main` and demonstrated end to end.

| Feature | ID | Priority | Status |
|---|---|---|---|
| GitHub integration & monitoring | F01 | P0 | Planned |
| Multi-step investigation trace | F02 | P0 | Planned |
| Project-aware RAG | F03 | P0 | Partial — file indexing exists |
| Selective escalation | F04 | P0 | Planned |
| Explainability & feedback | F05 | P0 | Planned |
| Duplicate & regression detection | F06 | P0 | Planned |
| Security-sensitive detection | F07 | P1 | Planned |
| Approval-controlled labeling | F08 | P1 | Planned |
| Incomplete-issue follow-up | F09 | P1 | Planned |
| Project-health analysis | F10 | P1 | Planned |
| Weekly brief | F11 | P2 | Stretch |
| MCP protocol server | F12 | P2 | Partial — 4 tools registered |
| Web dashboard | F13 | P0 | Planned |
| VS Code extension | F14 | P2 | Stretch |

**Working today:** the PR-review LangGraph pipeline
(`fetcher → reviewer → test_writer → summarizer`), a FastMCP stdio server over
PyGithub, and Chroma + MiniLM indexing of repository files.

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
| [TECHSTACK.md](TECHSTACK.md) | Dependencies, env vars, install |

Per-folder contracts: [agents/](agents/CLAUDE.md) · [rag/](rag/CLAUDE.md) ·
[mcp_server/](mcp_server/CLAUDE.md) · [memory/](memory/CLAUDE.md) ·
[api/](api/CLAUDE.md) · [dashboard/](dashboard/CLAUDE.md) ·
[vscode-extension/](vscode-extension/CLAUDE.md) · [scripts/](scripts/CLAUDE.md)

---

## Team

Four streams, exclusive file ownership. Details in [CLAUDE.md](CLAUDE.md) §5.

| Stream | Scope | Docs |
|---|---|---|
| **A** — Core & API | FastAPI, SQLite, MCP client, seed data | `api/`, `memory/` |
| **B** — Agents & RAG | LangGraph, triage nodes, Chroma, GitHub tools | `agents/`, `rag/`, `mcp_server/` |
| **C** — Frontend Core | Investigation trace, evidence, comparison | `dashboard/FRONTEND-C.md` |
| **D** — Shell & Extension | App shell, overview, escalations, health, VS Code | `dashboard/FRONTEND-D.md` |

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
