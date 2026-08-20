# Stream B — Agents & RAG

**Owner: Person B.** LangGraph graphs and nodes, Chroma + MiniLM retrieval, and
the GitHub-facing MCP tools.

## Read before working here

| File | What |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | **Agent operating manual — read first, always** |
| [CLAUDE.md](CLAUDE.md) | **The contract for this folder — graphs, nodes, `chain_step`** |
| [../rag/CLAUDE.md](../rag/CLAUDE.md) | Indexing, retrieval, duplicate detection |
| [../mcp_server/CLAUDE.md](../mcp_server/CLAUDE.md) | MCP tools and the GitHub client |
| [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | How the pieces fit and why |
| [../docs/INTELLIGENCE.md](../docs/INTELLIGENCE.md) | F17/F18 specs — both Stream B, neither built |

## You own

```
agents/                        graphs and nodes
  chain.py                       @chain_step — streaming + persistence + replay
  orchestrator.py                PR-review graph
  triage_graph.py                issue-triage graph
  triage/                        triage nodes, one per file
rag/                           Chroma + MiniLM indexing and retrieval
mcp_server/tools.py            MCP tool definitions
mcp_server/github_client.py    PyGithub wrapper
```

**Do not edit** `api/`, `memory/`, `mcp_server/client.py`,
`mcp_server/tool_names.py` (Stream A), or anything under `dashboard/`
(Streams C and D). See root `CLAUDE.md` §5.

---

## Rule 7 — the boundary you will be tempted to cross

**A node must never touch SQLite or the WebSocket hub.**

A node returns `(patch, evidence)`. That is the whole interface. The
`@chain_step` decorator in `agents/chain.py` builds the `StepRecord`, times it,
catches errors, and emits it to LangGraph's custom stream — and from that one
emission you get all three of:

1. **Live streaming** — the API runner forwards each record to the WebSocket
2. **Persistence** — the same record is written to the `chain_steps` table
3. **Replay** — `GET /api/investigations/{id}` rebuilds the chain from SQLite,
   so the demo survives a page refresh or an API restart in front of judges

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

**If you find yourself importing `memory` or `api` from inside `agents/`, you
have taken a wrong turn.** This is the single most important internal
boundary in the project, and it is the one that silently costs you all three
behaviors above when broken.

---

## Never hardcode an MCP tool name

Import from `mcp_server/tool_names.py`. Every name there is a constant for a
reason — **name drift caused 2 of the 8 bugs in the prototype**, and the
failure mode is a tool that silently never fires.

```python
from mcp_server.tool_names import GET_ISSUE, ADD_LABELS   # yes
tool = "get_issue_mcp"                                     # no
```

Note the suffixes are not uniform (`get_pullRequest_files` has no `_mcp`,
`get_issue_mcp` does). That inconsistency is exactly why you import the
constant instead of retyping the string.

`mcp_server/tool_names.py` is Stream A's file and shared-by-announcement. If
you need a new tool name, announce it — do not add it silently.

---

## Current state

**Triage graph** (`triage_graph.py`) is wired end to end:

```
START -> issue_fetcher -> duplicate_detector -> resolver -> security_scanner
      -> impact_scorer -> labeler -> decider -> END
```

**PR-review graph** (`orchestrator.py`): `fetcher → reviewer → test_writer →
summarizer`, working today.

**RAG:** Chroma + local `all-MiniLM-L6-v2`. `rag/graph.py` builds both the
issue-relationship graph (F15) and the semantic code graph.

| Piece | State |
|---|---|
| `chain.py` / `@chain_step` | Live — the mechanism everything depends on |
| PR-review graph | Live |
| Triage graph, all 7 nodes | Live |
| Duplicate + regression detection (F06) | Live |
| Security-sensitive detection (F07) | Live — layer-1 keyword matching |
| Approval-gated labeling (F08) | Live — `ADD_LABELS`, gated |
| Issue + code graph (F15) | Live |
| Resolution proposals (F16) | Live — approval-gated |
| Adaptive repository learning (F17) | **Not built** — spec in `docs/INTELLIGENCE.md` |
| MCP intelligence layer (F18) | Live — 7 read-only tools, `mcp_server/intelligence.py` |

**There is no OpenAI in this project.** Groq `openai/gpt-oss-120b` for
inference, local MiniLM for embeddings. No `openai` package, no
`OPENAI_API_KEY`, no `text-embedding-3-*`. The `openai/` in the Groq model
string is part of the model's name, not a provider — do not "fix" it into an
OpenAI client.

---

## Run

```bash
python app.py                              # PR review, CLI
uvicorn api.main:app --reload --port 8000  # exercises the triage graph
```

## Verify

```bash
pytest tests/test_chain.py -v              # StepRecord shape, add reducer, rule zero
pytest tests/test_security_scanner.py -v   # keyword matching, separators, dedup
pytest tests/test_retriever.py -v          # cosine recovery from L2, thresholds
```

None of the three need a backend or a network. `tests/test_chain.py` is the one
that locks the `@chain_step` contract — if you change `chain.py`, that file
tells you what you broke.

> `tests/manual_*.py` fire **real Groq and GitHub calls at import time**. They
> are named off the `test_*` prefix so pytest will not collect them. Do not
> rename them back and do not add them to CI.

## Definition of done

Root `CLAUDE.md` §9 applies in full — including no `TODO` or
`pass  # implement later` on a path the demo touches.
