# Doombot — Agent Operating Manual

**Read this file completely before your first tool call. It is binding.**

This file is the entry point for **both Claude Code and Codex**. Everything here
applies to both unless a section is explicitly marked otherwise.

Repo: `https://github.com/aryabailur/Doombot.git` · Team of 4 · Codeissance 2026, PS-04

---

## 1. What Doombot is

An **agentic open-source maintainer assistant**. It investigates GitHub issues and
pull requests the way a human triager would, and — this is the differentiator —
**shows its work** as a live, streaming, step-by-step reasoning chain that cites
its evidence.

It escalates only what needs a human, and posts real comments and labels back to
GitHub.

**Stack (this is the truth; ignore any doc that says otherwise):**
Python 3.14 · LangGraph · **Groq `openai/gpt-oss-120b`** · MCP (FastMCP) ·
PyGithub · ChromaDB + local `all-MiniLM-L6-v2` · FastAPI · SQLite ·
React + Vite + TypeScript + Tailwind · VS Code webview

> **There is no OpenAI in this project.** No `openai` package, no `OPENAI_API_KEY`,
> no `gpt-*` model string, no `text-embedding-3-*`. Embeddings are local and free.
> If you find a doc claiming otherwise, that doc is stale — fix the doc.

---

## 2. Non-negotiable rules

1. **Never commit directly to `main`.** One feature, one branch, one PR. See §6.
2. **Never invent a filename.** Every module you may create is listed in a
   `<folder>/CLAUDE.md`. If your task needs a file that isn't listed, stop and ask.
3. **Never rename or restructure another workstream's files.** Boundaries in §5.
4. **Never edit `api/schemas.py` after the contract freeze** without announcing it
   as a breaking change (§7). It is the shared contract between backend and frontend.
5. **Never hardcode an MCP tool name.** Import from `mcp_server/tool_names.py`.
   Name drift caused 2 of the 8 bugs in the prototype.
6. **Never commit secrets.** `.env` is gitignored. Only `.env.example` is tracked,
   and only with placeholder values.
7. **Never let a graph node touch SQLite or the WebSocket hub.** Nodes return
   `(patch, evidence)`. The `@chain_step` decorator does the rest. This is the
   single most important internal boundary.
8. **Never `git push --force`** to a shared branch.
9. **Never fabricate results.** If tests fail, say so and paste the output. If you
   skipped a step, say which one. A hackathon dies on false "it works" reports.
10. **Do not add dependencies** not in `requirements.txt` / `package.json` without
    flagging it. Every new package is install time on venue wifi.

---

## 3. Model orchestration policy

### For Claude Code

**Opus 5 orchestrates. Sonnet 5 implements.** Opus is the expensive, scarce
resource — spend it on planning, decomposition, integration, and review, not on
typing out boilerplate.

**Opus 5 does:**
- Read the relevant `CLAUDE.md` files and build the plan
- Decompose work into **independent** subagent tasks
- Define the interface contract each subagent must satisfy *before* dispatching
- Dispatch Sonnet 5 subagents via the `Agent` tool with `model: "sonnet"`
- Review returned diffs against the contract
- Resolve cross-file integration and merge conflicts
- Own the final commit and PR text

**Sonnet 5 subagents do:**
- Implement one file, or one tightly-scoped group of files
- Write the tests for what they implemented
- Return a summary of what changed and anything that surprised them

**Dispatch template — copy this shape:**

```
Agent(
  subagent_type: "general-purpose",
  model: "sonnet",
  description: "Implement memory/db.py",
  prompt: """
  Read memory/CLAUDE.md in full first.

  TASK: Implement ONLY memory/db.py.

  CONTRACT — these exact signatures, no others:
    get_conn() -> sqlite3.Connection
    init_db() -> None

  MUST:
    - stdlib sqlite3 only; check_same_thread=False; WAL mode
    - exact DDL from memory/CLAUDE.md section "Schema", verbatim
    - DB path from env DB_PATH, default ./doombot.db

  MUST NOT:
    - touch any file other than memory/db.py
    - import anything from api/, agents/, or rag/
    - add a migration framework

  VERIFY: python -c "from memory.db import init_db; init_db()" then confirm
  all 5 tables exist via sqlite3.

  Report: what you wrote, verification output, anything ambiguous.
  """
)
```

**Parallelism:** dispatch independent subagents **in a single message** so they run
concurrently. Do not dispatch two subagents that write the same file — ever.

**Rules of thumb:**
- 3+ files, no shared state → parallel Sonnet subagents
- Anything touching `api/schemas.py` → Opus does it directly, alone
- Merge conflict or failing integration → Opus, never delegated
- Task fits in one file with a clear contract → always Sonnet

### For Codex

Codex has no subagent model. Work **one file per session**. Before starting:

1. Read this file, then the `CLAUDE.md` of the folder you are editing.
2. Restate the contract you are implementing in your own words.
3. Confirm the file is on your branch's ownership list (§5).
4. Implement, run the verification command in that folder's doc, then commit.

Do not open a second file "while you're in there." If you believe a second file
needs changing, finish the first, commit, and start a new session.

---

## 4. The one architectural idea you must understand

Everything hinges on `agents/chain.py`.

Every LangGraph node is wrapped by a `@chain_step` decorator. The decorator emits a
`StepRecord` to LangGraph's custom stream via `get_stream_writer()`, and also
appends it to `state["chain"]`.

That single mechanism produces three things at once:

1. **Live streaming** — the API runner forwards each record to the WebSocket
2. **Persistence** — the same record is written to the `chain_steps` table
3. **Replay** — `GET /api/investigations/{id}` rebuilds the chain from SQLite, so
   the demo survives a page refresh or an API restart in front of judges

```
node returns (patch, evidence)
        |
   @chain_step  builds StepRecord, times it, catches errors
        |
   get_stream_writer()  ->  astream(stream_mode="custom")
        |
        +--> memory/repo.insert_step()   (persist)
        +--> api/ws.broadcast()          (live)
```

**Consequence:** a node author never writes DB or socket code. If you find yourself
importing `memory` or `api` from inside `agents/`, you have taken a wrong turn.

---

## 5. Workstreams and file ownership

Four people. Ownership is exclusive — do not edit another stream's files.

| Stream | Owner | Owns | Doc |
|---|---|---|---|
| **A — Core & API** | Person A | `api/`, `memory/`, `mcp_server/client.py`, `mcp_server/tool_names.py`, `scripts/` | `api/CLAUDE.md`, `memory/CLAUDE.md` |
| **B — Agents & RAG** | Person B | `agents/`, `rag/`, `mcp_server/github_client.py`, `mcp_server/tools.py` | `agents/CLAUDE.md`, `rag/CLAUDE.md`, `mcp_server/CLAUDE.md` |
| **C — Frontend Core** | Person C | `dashboard/src/lib/`, `dashboard/src/components/Chain*`, `Evidence*`, `Investigation*` | `dashboard/CLAUDE.md`, `dashboard/FRONTEND-C.md` |
| **D — Frontend Shell + Ext** | Person D | `dashboard/src/App.tsx`, `components/Repo*`, `Escalation*`, `Activity*`, `vscode-extension/` | `dashboard/FRONTEND-D.md`, `vscode-extension/CLAUDE.md` |

**Shared, change only by announcement:** `api/schemas.py`, `agents/state.py`,
`mcp_server/tool_names.py`, `requirements.txt`, `.env.example`.

---

## 6. Git workflow — mandatory

`main` is protected by convention. Every change arrives via PR.

### Branch naming

```
feat/<stream>-<slug>     feat/a-sqlite-layer, feat/b-triage-graph
fix/<stream>-<slug>      fix/b-mcp-tool-names
docs/<slug>              docs/agent-manuals
chore/<slug>             chore/requirements
```

`<stream>` is `a`, `b`, `c`, or `d`.

### Cycle

```bash
git checkout main && git pull origin main       # ALWAYS start fresh
git checkout -b feat/a-sqlite-layer

# ... work, in small commits ...
git add <specific files>                        # never `git add -A`
git commit -m "feat(memory): add SQLite schema and connection helper"

git fetch origin && git rebase origin/main      # resolve conflicts HERE, not in the PR
git push -u origin feat/a-sqlite-layer
gh pr create --base main --title "..." --body "..."
```

### Commit format

Conventional Commits: `type(scope): summary`

```
feat(api): add investigation routes with fixture responses
fix(mcp): correct post_review_comment tool name mismatch
docs(agents): document chain_step contract
```

Types: `feat` `fix` `docs` `chore` `refactor` `test`

### Rules

- **Rebase onto `origin/main` before every push.** Conflicts get resolved on your
  branch, never in the PR.
- Keep PRs under ~400 lines where you can. Big PRs don't get reviewed at 3am.
- One reviewer approval before merge. **Squash merge**, then delete the branch.
- If `main` breaks, fixing it preempts all other work.
- Sequenced dependency: if B needs A's merged work, B waits for the merge and
  rebases — B does not copy A's code onto B's branch.

### PR body template

```markdown
## What
One or two sentences.

## Stream
A / B / C / D

## Contract
Which section of which CLAUDE.md this satisfies.

## Verification
Exact commands run, and their output.

## Contract changes
None. (Or: describe the breaking change and who was told.)
```

---

## 7. The contract freeze

`api/schemas.py` is **the** interface between backend and frontend.

Person A ships it first, with **every endpoint returning hardcoded fixtures** that
match the models. Frontend then builds against real HTTP responses from hour one
and is never blocked on backend logic.

**Changing `api/schemas.py` after the freeze:**
1. Announce it to the team before writing the code
2. Change `api/schemas.py` and `dashboard/src/lib/types.ts` **in the same PR**
3. Title the PR `feat(api)!: ...` — the `!` marks it breaking
4. Ping both frontend owners on the PR

Frontend types are hand-mirrored from `schemas.py`. There is no codegen; keeping
them in sync is a human responsibility, enforced by rule 2 above.

---

## 8. Documentation map

Read the root file, then only the folder you are working in.

```
CLAUDE.md                       this file — read first, always
AGENTS.md                       Codex entry point (points here)
docs/ARCHITECTURE.md            system design and data flow
docs/WORKFLOW.md                git, PR, and integration protocol in depth
docs/FEATURES.md                feature list mapped to owners and branches
docs/PLAN.md                    hour-boxed schedule, gates, demo script

agents/CLAUDE.md                graphs, nodes, the chain_step contract
rag/CLAUDE.md                   indexing, retrieval, duplicate detection
mcp_server/CLAUDE.md            MCP tools, GitHub client
memory/CLAUDE.md                SQLite schema and helpers
api/CLAUDE.md                   endpoints, WebSocket protocol, schemas
dashboard/CLAUDE.md             frontend rules, conventions, workflow
dashboard/FRONTEND-C.md         Person C's components
dashboard/FRONTEND-D.md         Person D's components
vscode-extension/CLAUDE.md      the single-webview extension
scripts/CLAUDE.md               seed data and operational scripts
```

---

## 9. Definition of done

A task is done when **all** of these hold:

- [ ] Implements the contract in the folder's `CLAUDE.md`, exactly
- [ ] The folder's verification command runs clean, output pasted in the PR
- [ ] No new file outside the contract
- [ ] No `TODO` or `pass  # implement later` in a path the demo touches
- [ ] Rebased onto `origin/main`, no conflicts
- [ ] PR opened with the template filled in

If you cannot finish, **say what is incomplete and why**. A known gap is
recoverable; a silent one is what loses the demo.
