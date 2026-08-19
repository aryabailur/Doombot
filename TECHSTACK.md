# Doombot — Tech Stack

Everything needed to install, configure, and run the project.

> **This file was rewritten to match reality.** An earlier version described
> OpenAI, Docker sandboxes, tree-sitter, TextBlob, scikit-learn, and a product
> named "RepoGuardian" — none of which exist in this repository. Judges read this
> file; a stack doc that doesn't match the code is worse than no doc.
>
> **There is no OpenAI in Doombot.** Reasoning runs on Groq. Embeddings run
> locally on CPU. Both are free.

---

## Languages

**Python 3.14** — backend, agents, RAG, MCP server. 3.14 is what's installed, and
cp314 wheels exist for every dependency below. Do not detour into installing 3.11.

**TypeScript 5.3+** — dashboard and VS Code extension. Strict mode on. One language
across both frontend surfaces means any of the four of us can work on either.

---

## AI and ML

**Groq (`langchain-groq`)** — `openai/gpt-oss-120b` for every LLM call:

> The model id starts with `openai/` because it is OpenAI's **open-weights**
> release, served on Groq's hardware. It is not the OpenAI API: no
> `OPENAI_API_KEY`, no OpenAI account, no per-token bill. The only credential is
> `GROQ_API_KEY`. Groq retired `llama-3.3-70b-versatile`, which is why the
> earlier docs named a model that no longer exists.

classification, severity assessment, recommendations, PR review, summaries. Chosen
over OpenAI for three reasons that matter at a hackathon: it's free, it's
dramatically faster per token, and it needs no billing setup. Model is read from
`GROQ_MODEL` so it's swappable.

**LangGraph** — agent orchestration. Two `StateGraph`s over one shared `TypedDict`:
the existing PR-review graph and the new issue-triage graph. Chosen over raw
LangChain agents because the investigation trace *is* the product — LangGraph's
custom stream (`get_stream_writer`) is what makes each reasoning step visible live.

**sentence-transformers + `langchain-huggingface`** — `all-MiniLM-L6-v2`, 384-dim,
running locally on CPU. No API key, no per-token cost, no network dependency during
the demo. This is the backbone of semantic duplicate detection.

**ChromaDB (`langchain-chroma`)** — embedded vector store, persisting to
`./chroma_db/`. Two collections per repo: `{repo}-code` and `{repo}-issues`.
Embedded mode means no separate database server.

> `torch` arrives as a sentence-transformers dependency. Install it **CPU-only** —
> the default CUDA build is a ~2.4GB download versus ~200MB:
> ```bash
> pip install torch --index-url https://download.pytorch.org/whl/cpu
> ```

---

## Backend

**FastAPI** — REST plus WebSocket in one app. Native async matters here: the graph
runner streams steps to the socket while GitHub and Groq calls are in flight.

**Uvicorn** — ASGI server. `--reload` in development.

**Pydantic** — request/response validation. `api/schemas.py` is the frozen contract
between backend and frontend.

**SQLite (stdlib `sqlite3`)** — investigations, chain steps, escalations, health
time series, feedback. WAL mode, `check_same_thread=False`. No `aiosqlite`: writes
are sub-millisecond at demo scale, and it's one less dependency.

Persistence is what makes the trace **refresh-proof** — `GET /api/investigations/{id}`
replays from SQLite, so a page refresh or an API restart in front of judges is
survivable.

---

## GitHub integration

**PyGithub** — issues, PRs, comments, labels, file contents, repo tree. Handles
auth, pagination, and rate limits.

**MCP / FastMCP** — the agent's GitHub tools are exposed as Model Context Protocol
tools, so tool use is inspectable and any MCP client can drive them.

The client runs in two modes behind one interface (`USE_MCP_SUBPROCESS`): direct
dispatch by default (zero subprocess risk), or a real stdio session spawned as
`python -m mcp_server.server` for demonstrating the MCP surface.

**Not used:** webhooks. They need ngrok and a public URL, and they fail on venue
wifi. Investigations are triggered by an API call; the code path is identical to
what a webhook would invoke.

---

## Frontend

**React 18 + Vite + TypeScript** — dashboard. Vite for instant HMR.

**Tailwind CSS + shadcn/ui** — one component system, not three. `docs/DESIGN.md` §9
is explicit: do not mix shadcn, Primer, and Radix Themes. Design tokens are defined
once in `docs/DESIGN.md` §8 and consumed as Tailwind color names — never raw hex.

**Recharts** — health trend charts.

**lucide-react** — icons, mapped to meanings in `docs/DESIGN.md` §8.

**VS Code Extension API** — a companion surface: status bar health score,
escalation tree view, and a webview onto the dashboard. P2 stretch scope.

---

## Environment variables

```bash
GITHUB_TOKEN=ghp_...                     # repo scope
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-120b

DB_PATH=./doombot.db
CHROMA_DIR=./chroma_db

USE_MCP_SUBPROCESS=0                     # 0 = direct dispatch (default), 1 = stdio session
DEMO_MODE=0                              # 1 = canned LLM responses, demo fallback
```

No `OPENAI_API_KEY`. If you find one referenced anywhere, it's a bug.

---

## Ports

| Service | Port | Protocol |
|---|---|---|
| Backend API | 8000 | HTTP |
| WebSocket | 8000 | WS (`/ws`) |
| Dashboard (Vite) | 5173 | HTTP |

---

## Install

**Backend:**
```bash
python -m venv .venv
.venv\Scripts\activate                   # Windows
# source .venv/bin/activate              # macOS / Linux

pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt

cp .env.example .env                     # then fill in GITHUB_TOKEN and GROQ_API_KEY
uvicorn api.main:app --reload --port 8000
```

**Dashboard:**
```bash
cd dashboard
npm install
npm run dev                              # http://localhost:5173
```

**VS Code extension:**
```bash
cd vscode-extension
npm install && npm run compile
# then F5 in VS Code to launch the Extension Development Host
```

---

## Verification

```bash
curl http://localhost:8000/api/health              # -> {"status":"ok"}
wscat -c ws://localhost:8000/ws                    # live step events
python -m scripts.seed_demo                        # demo fallback data
```

---

## Deliberately not used

| Not used | Why |
|---|---|
| OpenAI | Groq is free and faster; embeddings are local |
| Docker sandbox | Out of MVP scope (`docs/DESIGN.md` §3) |
| tree-sitter / AST analysis | Out of MVP scope |
| scikit-learn / NumPy | Chroma handles similarity; no separate ML step |
| TextBlob | Toxicity scoring is out of scope |
| Webhooks | Needs a public URL; unreliable on venue wifi |
| Postgres / Redis | SQLite and an embedded Chroma are sufficient |
| aiosqlite | Writes are sub-millisecond at this scale |

---

*Built for Codeissance 2026 — PS-04*
