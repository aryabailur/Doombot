# Doombot — Codeissance 2026 PS-04 Implementation Plan

## Context

Doombot today is a ~450-line weekend prototype: a working-in-principle LangGraph PR-review
agent (fetcher → reviewer → test_writer → summarizer) backed by a FastMCP stdio server over
PyGithub, with a Chroma + MiniLM RAG index over repo files. It runs on **Groq
llama-3.3-70b-versatile**, not OpenAI.

`finalFeatures.md` and `TECHSTACK.md` describe a far larger system — issue triage, escalation
queues, health scoring, a React dashboard, a VS Code extension. Neither doc matches the code:
TECHSTACK.md claims OpenAI/FastAPI/React, none of which exist here.

This plan pivots Doombot to the **agentic open-source maintainer assistant** described in
`finalFeatures.md`, **reusing the existing LangGraph / MCP / RAG core**, keeping **Groq +
local MiniLM embeddings** (free, fast, no OpenAI key), and shipping **both** a dashboard and a
VS Code extension. Target: 24–36 hours, 3 people in parallel.

Outcome: an agent that investigates a GitHub issue in a **visible, streaming, step-by-step
reasoning chain**, cites its evidence, escalates only what needs a human, and posts real
comments/labels back to GitHub — all renderable in a browser and inside VS Code.

---

## Blocking reality check (verified — read this first)

1. **Nothing runs today.** `langchain`, `langchain_groq`, `langchain_chroma`,
   `langchain_community`, `chromadb`, `PyGithub`, `sentence_transformers`, `torch` are all
   **not installed**. The code fails at import, before any of the known bugs fire.
2. **Only Python 3.14.4 is available.** cp314 wheels exist for every dependency, so 3.14 is
   viable — do NOT detour into installing 3.11. But **torch is a ~2.4GB download**; install
   CPU-only (`--index-url https://download.pytorch.org/whl/cpu`, ~200MB) and **start it at
   minute zero in the background**.
3. **No `.env` exists.** `GITHUB_TOKEN` and `GROQ_API_KEY` are unset.
4. `chroma_db/` holds one collection with **0 embeddings** — indexing has never succeeded.
5. `langchain_community.embeddings.HuggingFaceEmbeddings` is **removed** in current
   langchain-community. [rag/embedder.py:4](rag/embedder.py#L4) must become
   `from langchain_huggingface import HuggingFaceEmbeddings`.

---

## Phase 0 (H0–H2) — Stabilization. Person A owns. Nobody branches until this lands.

**H0:00 — start the long pole immediately, then continue while it downloads:**
```
python -m venv .venv
.venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

**`requirements.txt`** (new, repo root — torch omitted, installed separately CPU-only):
```
langgraph>=1.2.9
langchain-core>=1.4
langchain-groq
langchain-chroma
langchain-huggingface
langchain-text-splitters
langchain-community
sentence-transformers
chromadb
PyGithub
mcp>=1.28
fastapi
uvicorn[standard]
python-dotenv
pydantic
```

**`.env.example`** (new):
```
GITHUB_TOKEN=ghp_xxx
GROQ_API_KEY=gsk_xxx
GROQ_MODEL=llama-3.3-70b-versatile
DB_PATH=./repoguardian.db
CHROMA_DIR=./chroma_db
DEMO_MODE=0
```

**Fixes, in order:**

| # | Fix | Files |
|---|---|---|
| 1 | Add empty `__init__.py` | `agents/`, `mcp_server/`, `rag/`, `memory/` |
| 2 | Absolute imports | [mcp_server/tools.py:2-5](mcp_server/tools.py#L2-L5) → `from mcp_server.github_client import ...`; [mcp_server/server.py:1](mcp_server/server.py#L1) → `from mcp_server.tools import mcp` |
| 3 | Spawn as module, not script | Every `StdioServerParameters` → `args=["-m","mcp_server.server"]` (see [agents/fetcher.py:8-10](agents/fetcher.py#L8-L10)). Puts repo root on `sys.path` with zero hacks — do this rather than `sys.path.insert`. |
| 4 | MCP tool-name mismatches | `agents/summarizer.py`: `"post_review_comment"` → `"post_review_comment_mcp"`; `agents/reviewer.py`: `"get_file_content"` → `"get_file_content_mcp"` |
| 5 | **Prevent recurrence** | New `mcp_server/tool_names.py` with constants `GET_PR_FILES / GET_FILE_CONTENT / GET_PR_DETAILS / POST_COMMENT`. Import these everywhere; never a string literal again. Name drift caused 2 of the 8 known bugs. |
| 6 | Deprecated embeddings import | [rag/embedder.py:4](rag/embedder.py#L4) → `langchain_huggingface` |
| 7 | State typing | [agents/state.py:11](agents/state.py#L11) `test_metadata: list` → `str` |
| 8 | Full re-embed on every run | [app.py:18](app.py#L18) calls `embeder(repo_name)` unconditionally — move behind an explicit index command / API call |

**Fix 9 — one shared MCP session** (currently 3 subprocess spawns per run, each re-importing
torch + chromadb). New **`mcp_server/client.py`**: module-level singleton exposing
`async call(tool_name, args) -> str`, plus `startup()` / `shutdown()` held in an
`AsyncExitStack` entered once on FastAPI startup. Provide a sync `call_tool_sync()` wrapper
(via `asyncio.run_coroutine_threadsafe`) for the sync LangChain `@tool` functions in
[agents/reviewer.py](agents/reviewer.py).

> **Recommended default:** have `client.py` dispatch **directly to
> `mcp_server.github_client`** functions behind that same `call(name, args)` signature, and
> keep `server.py` alive purely as the demoable MCP surface (judges verify it with MCP
> Inspector). Same interface, zero subprocess risk, no lost demo value. Gate it with a
> `USE_MCP_SUBPROCESS` env flag so you can flip to real stdio for the judges.

**GATE 1 (H2, non-negotiable):** `python app.py` posts a real comment on a real PR. Nobody
builds new features until this is green. Tag `stabilize` on `main`; everyone branches from it.

---

## Architecture

**Two graphs, one shared state schema, one shared node toolkit.** Not one graph with a
conditional branch — a branch forces every field optional for both paths, and the node sets are
genuinely disjoint. Two `StateGraph`s over one `TypedDict` gives reuse without `if` spaghetti,
and lets Person B build triage without touching Person A's working PR graph.

```
Doombot/
├─ agents/
│  ├─ state.py            # EXTENDED GraphState (superset, total=False)
│  ├─ chain.py            # NEW  @chain_step decorator  ← hero feature
│  ├─ orchestrator.py     # EXISTING pr_app, behavior unchanged
│  ├─ triage_graph.py     # NEW  issue_app
│  ├─ fetcher.py reviewer.py test_writer.py summarizer.py
│  └─ triage/             # NEW, one node per file
│     ├─ issue_fetcher.py  duplicate_detector.py  security_scanner.py
│     └─ impact_scorer.py  labeler.py  decider.py
├─ mcp_server/
│  ├─ client.py  tool_names.py          # NEW
│  ├─ github_client.py                  # EXTENDED: get_issues, get_issue,
│  │                                    #   post_issue_comment, add_labels
│  └─ tools.py  server.py
├─ rag/  embedder.py  retriever.py      # EXTENDED
├─ memory/  db.py  repo.py              # NEW (store.py is currently 0 bytes)
├─ api/
│  ├─ main.py  ws.py  schemas.py        # schemas.py = THE CONTRACT
│  └─ routes_investigations.py  routes_repos.py  routes_feedback.py
├─ dashboard/            # React + Vite + Tailwind
├─ vscode-extension/
└─ scripts/seed_demo.py  # demo insurance
```

**Extended `GraphState`** ([agents/state.py](agents/state.py)) — superset; each graph ignores
the other's keys:
```python
class GraphState(TypedDict, total=False):
    # existing
    repo_name: str; pr_number: int; pr_metadata: dict
    diff_files: list[dict]
    review_metadata: Annotated[list[dict], add]
    test_metadata: str                      # FIXED from list
    summary_metadata: str
    # new — triage
    investigation_id: str
    issue_number: int
    issue_metadata: dict
    duplicates: list[dict]                  # [{number,title,score}]
    security_findings: list[dict]
    impact_score: int
    labels: list[str]
    decision: dict                          # {action, reason, confidence}
    chain: Annotated[list[dict], add]       # step records
```
`chain` reuses the `Annotated[..., add]` reducer already proven by `review_metadata` at
[agents/state.py:10](agents/state.py#L10) — nodes just `return {"chain": [step]}`.

---

## The investigation chain (HERO feature)

Use **`get_stream_writer()` from `langgraph.config`** (verified present in the installed
langgraph 1.2.9). Beats `astream_events` (no need to reverse-engineer LangChain's event
taxonomy) and beats state-only append (which can't emit mid-node "started" events, so the UI
would jump instead of stream).

One decorator in **`agents/chain.py`**, applied to every node; nodes stay dumb and return
`(patch, evidence)`:

```python
def chain_step(name: str, title: str):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(state):
            writer = get_stream_writer()
            rec = {..., "status": "running", "seq": next_seq(state)}
            writer({"type": "step.started", "data": rec})
            t0 = time.perf_counter()
            try:
                patch, evidence = _split(fn(state))
                rec |= {"status": "done", "evidence": evidence,
                        "duration_ms": int((time.perf_counter() - t0) * 1000)}
            except Exception as e:
                rec |= {"status": "error", "output_summary": str(e)}
                writer({"type": "step.completed", "data": rec}); raise
            writer({"type": "step.completed", "data": rec})
            return {**patch, "chain": [rec]}     # also persists into state
        return wrapper
    return deco
```

Runner in `api/routes_investigations.py`:
```python
async for mode, chunk in issue_app.astream(init, stream_mode=["custom", "updates"]):
    if mode == "custom":
        db.insert_step(chunk["data"])
        await ws.broadcast(chunk)
```

One code path gives **live WS streaming + DB persistence + replay on refresh**.
`GET /api/investigations/{id}` just replays `chain_steps` — the demo survives a page refresh or
an API restart in front of judges. Worth the ~45 minutes.

---

## Backend — FastAPI

`api/main.py`: mount routers, CORS for `http://localhost:5173`, on startup call
`memory.db.init_db()` and `mcp_server.client.startup()`.

**Freeze this contract at H2.** Person A ships every endpoint returning **hardcoded fixtures**
before writing real logic, so Person C is never blocked.

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{status:"ok"}` |
| GET | `/api/repos` | `[{repo_name, health_score, open_investigations, last_scan}]` |
| POST | `/api/repos/{owner}/{repo}/index` | `{job_id, status}` — triggers RAG index |
| GET | `/api/repos/{owner}/{repo}/health` | `{score, breakdown:{security,staleness,duplication,responsiveness}, history:[{ts,score}]}` |
| POST | `/api/investigations` | `{repo_name, kind:"issue"\|"pr", number}` → `{investigation_id}`; runs graph as background task |
| GET | `/api/investigations` | `[{id, repo_name, kind, number, title, status, decision, created_at}]` |
| GET | `/api/investigations/{id}` | detail + `steps:[StepRecord]` + evidence |
| GET | `/api/escalations` | `[{investigation_id, reason, severity, number, title, created_at}]` |
| POST | `/api/feedback` | `{investigation_id, step_id?, verdict:"up"\|"down", note?}` → `{ok:true}` |
| GET | `/api/brief/{owner}/{repo}` | `{markdown, generated_at}` |
| WS | `/ws` | see below |

`StepRecord` — **identical shape in DB, WS, and REST**; define once in `api/schemas.py`:
```json
{ "step_id":"...", "investigation_id":"...", "seq":3,
  "name":"duplicate_detector", "title":"Checking for duplicates",
  "status":"running|done|error",
  "input_summary":"...", "output_summary":"...",
  "evidence":[{"type":"issue","ref":"#412","score":0.91,"snippet":"..."}],
  "duration_ms":842, "started_at":"...", "ended_at":"..." }
```

**WebSocket** — single `/ws`, module-level `set[WebSocket]` hub in `api/ws.py` with
`async def broadcast(event)`. No rooms, no auth: broadcast everything, client filters by
`investigation_id`. Correct at demo scale, saves an hour.
```json
{"type":"step.started","data":StepRecord}
{"type":"step.completed","data":StepRecord}
{"type":"investigation.completed","data":{investigation_id,decision,health_delta}}
{"type":"activity","data":{ts,repo_name,message,severity}}
```

---

## Data layer — SQLite

`memory/db.py` — stdlib `sqlite3` (skip `aiosqlite`; not installed, writes are sub-ms here),
`check_same_thread=False` + WAL. `init_db()` runs inline `CREATE TABLE IF NOT EXISTS` DDL — no
migration tooling. DB at `./repoguardian.db`, gitignored. `memory/repo.py` holds
insert/query helpers. This finally fills the empty [memory/store.py](memory/store.py).

```sql
CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY, repo_name TEXT NOT NULL,
  kind TEXT NOT NULL, number INTEGER NOT NULL, title TEXT,
  status TEXT NOT NULL,                    -- running|completed|error
  decision TEXT, decision_reason TEXT, confidence REAL,
  impact_score INTEGER, created_at TEXT, completed_at TEXT);

CREATE TABLE IF NOT EXISTS chain_steps (
  step_id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL,
  seq INTEGER, name TEXT, title TEXT, status TEXT,
  input_summary TEXT, output_summary TEXT,
  evidence_json TEXT, duration_ms INTEGER,
  started_at TEXT, ended_at TEXT,
  FOREIGN KEY(investigation_id) REFERENCES investigations(id));

CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, investigation_id TEXT,
  repo_name TEXT, reason TEXT, severity TEXT,
  resolved INTEGER DEFAULT 0, created_at TEXT);

CREATE TABLE IF NOT EXISTS health_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, repo_name TEXT,
  score INTEGER, security INTEGER, staleness INTEGER,
  duplication INTEGER, responsiveness INTEGER, recorded_at TEXT);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, investigation_id TEXT,
  step_id TEXT, verdict TEXT, note TEXT, created_at TEXT);

CREATE INDEX IF NOT EXISTS idx_steps_inv ON chain_steps(investigation_id, seq);
CREATE INDEX IF NOT EXISTS idx_inv_repo  ON investigations(repo_name, created_at DESC);
```

---

## RAG changes

**[rag/embedder.py](rag/embedder.py)**
- Fix the deprecated import (Phase 0 fix 6).
- Make `model` **lazy** — a `_get_model()` singleton instead of the module-level construction
  at [rag/embedder.py:7](rag/embedder.py#L7). Today importing the module loads MiniLM in every
  process, which is why the 3-subprocess spawn was so costly. Note
  [rag/retriever.py:2](rag/retriever.py#L2) imports `model` directly and must change too.
- Add `index_issues(repo_name)`: one `Document` per issue,
  `page_content = f"{title}\n\n{body}"`,
  `metadata={"type":"issue","number":n,"state":...,"labels":...,"created_at":...}`.
  **Do not chunk issues** — chunking destroys duplicate detection by comparing fragments.
  Chunk repo files only (the existing 500/50 splitter stays for those).
- Tag existing file docs with `metadata={"type":"file"}`.
- **Incremental:** `vector_db.add_documents(docs, ids=[f"issue-{n}"])`. Chroma upserts by ID, so
  re-running is idempotent and cheap — this replaces the `Chroma.from_documents` full rebuild at
  [rag/embedder.py:26](rag/embedder.py#L26).
- Two collections: `{repo}-code` and `{repo}-issues`. Simpler than metadata filtering, faster
  duplicate search.

**[rag/retriever.py](rag/retriever.py)**
- Add `retrieve_with_scores(query, repo_name, collection, k)` using
  **`similarity_search_with_relevance_scores`** (normalized 0–1). Do **not** use
  `similarity_search_with_score`, which returns L2 *distance* (lower = better) — inverting that
  is a classic silent bug.
- Add `find_duplicates(issue_text, repo_name, exclude_number)` →
  `{"duplicates": [>0.85], "related": [0.65–0.85]}`, matching finalFeatures.md §6.
  **Must exclude the issue's own number** — otherwise every issue is its own perfect duplicate.
  This is the single most likely demo-breaking bug in the feature.

---

## Frontends (be ruthless)

**`dashboard/`** — Vite + React + TS + Tailwind. Six components, one `useState` tab, no router.
```
src/lib/api.ts                     # typed fetch wrappers, mirrored from schemas.py
src/lib/useSocket.ts               # single WS hook
src/components/RepoHealthCard.tsx      # score + 4 breakdown bars
src/components/InvestigationList.tsx
src/components/ChainViewer.tsx         # ← THE HERO: vertical timeline, animates on step.started
src/components/EvidencePanel.tsx       # citations for the selected step
src/components/EscalationQueue.tsx
src/components/ActivityFeed.tsx
src/App.tsx
```
**Cut:** routing, auth, dark-mode toggle, **Recharts**. Health history = a ~20-line inline SVG
sparkline; a charting library costs more time than it returns.

**`vscode-extension/`** — biggest scope trap. Hold it to a **single webview**.
```
package.json        # one command: doombot.open
src/extension.ts    # activate() -> WebviewPanel -> iframe onto localhost:5173
```
Make the webview an **iframe onto the running dashboard**: the whole UI inside VS Code for ~40
lines and zero duplicated React. Judges see a real extension; you spend 30 minutes, not 6 hours.
Do **not** build tree views, diagnostics providers, or CodeLens.

---

## Three-person split

The trick is the **H2 contract freeze**: `api/schemas.py` + every endpoint returning fixtures,
pushed before any real logic. Person C then never blocks on Person A.

| | **A — Core/Backend** | **B — Agents/RAG** | **C — Frontend** |
|---|---|---|---|
| H0–2 | **Phase 0 stabilization** | Read code, write `.env`, hand-test GitHub API in a REPL, start torch install | `npm create vite`, Tailwind, static mockup |
| H2–3 | **Freeze contract**: schemas + fixture endpoints. Push. | `memory/db.py` + `repo.py` | Build against fixtures |
| H3–10 | WS hub, graph runner, streaming→DB, health scoring | `triage_graph.py` + 6 nodes + `chain_step` decorator; issue indexing + dup detection | ChainViewer, InvestigationList, EvidencePanel |
| H10–16 | Escalation logic, brief endpoint, `seed_demo.py` | Security scanner (keyword layer), labeler, impact scorer | EscalationQueue, ActivityFeed, health card |
| H16–20 | Integration: real graph → real WS | Prompt tuning, output-parsing hardening | VS Code extension webview |
| H20–26 | **Full integration + demo rehearsal (all three)** | | |
| H26–30 | Buffer / bug fixing | | |
| H30+ | Freeze. Rehearse 3×. | | |

Interface boundary that keeps A and B from colliding: **B's nodes return `(patch, evidence)`
and never touch the DB or WS** — the decorator handles all of it.

---

## Demo script (3 minutes)

1. **0:00–0:20** — "Maintainers drown in issues. Doombot investigates them like a human
   triager, and shows its work."
2. **0:20–0:50** — Dashboard: repo health **62/100**, 4 escalations queued.
3. **0:50–2:00 — THE HERO.** Click a fresh issue; the chain **streams in live**:
   Fetch issue → search 340 indexed issues → *"Found #412, cosine 0.91 — duplicate"* →
   security scan → *"mentions `API_KEY` in a traceback — potential secret leak"* →
   impact score 87 → **Decision: ESCALATE (security + high impact)**.
   Click a step → evidence citations with scores.
4. **2:00–2:30** — Show the auto-posted GitHub comment and labels **on the real repo**. Real
   side effects on real GitHub is what separates you from the demo-video teams.
5. **2:30–2:50** — Same agent, same MCP tools, inside **VS Code**.
6. **2:50–3:00** — Thumbs-down a step → feedback logged. "Explainable, correctable, and it runs
   on Groq + local embeddings — no OpenAI."

**MUST-HAVE:** stabilized core · issue triage graph · **streaming chain viewer** · duplicate
detection · security keyword layer · escalation queue · real GitHub comment · health score.

**CUT LIST, in this order, without hesitation:**
1. Weekly brief — one LLM call, zero visual payoff. Static markdown if asked.
2. Agentic polling loop — judges can't see a cron job. Use a "Scan now" button; *say* it runs on
   a schedule in production.
3. Webhooks — needs ngrok and public URLs, dies on venue wifi. The button is strictly better.
4. Health-score time series — needs history you won't have. Seed 7 points.
5. Auto-comment on incomplete issues — overlaps the escalation path.
6. LLM security layer — keep the deterministic keyword layer; add LLM only if ahead.
7. Feedback affecting behavior — log and display it, don't act on it.
8. Test-writer node in the triage path — exists for PRs; don't generalize.

---

## Verification

- **Gate 1 (H2):** `python app.py` posts a real PR comment. Blocks all new feature work.
- **Gate 2 (H3):** `curl` every endpoint; JSON matches `api/schemas.py`. Person C unblocked.
- **Gate 3 (H10):** `wscat -c ws://localhost:8000/ws` shows ordered `step.started` /
  `step.completed` for one investigation.
- **Gate 4 (H16):** Kill and restart the API mid-investigation;
  `GET /api/investigations/{id}` replays the full chain from SQLite.
- **`scripts/seed_demo.py`** (build by H16 — this is insurance): pre-creates 3 completed
  investigations, 4 escalations, 7 health-score points. If GitHub or Groq fails mid-demo, you
  present seeded data and nobody can tell. Pair it with `DEMO_MODE=1` serving canned LLM
  responses — a Groq rate limit at the worst moment is a real hackathon failure mode.
- Rehearse the full 3 minutes **three times**, on the actual demo machine, on venue wifi, after
  freeze.

---

## Docs to rewrite (30 min, Person A, after Gate 2)

- **`README.md`** — currently 2 bytes (`# test`). Needs: what Doombot is, architecture diagram,
  setup, run commands.
- **`TECHSTACK.md`** — currently describes OpenAI, Docker sandboxes, tree-sitter, TextBlob,
  scikit-learn, Recharts, and a "RepoGuardian" that doesn't exist. Rewrite to the real stack:
  Python 3.14, LangGraph, Groq llama-3.3-70b, MCP/FastMCP, PyGithub, Chroma + MiniLM, FastAPI,
  SQLite, React/Vite/Tailwind, VS Code webview. **Judges read this** — a doc that doesn't match
  the repo is worse than no doc.
- **`finalFeatures.md`** — retitle to Doombot; mark cut features as "roadmap" rather than
  claiming them as shipped.
