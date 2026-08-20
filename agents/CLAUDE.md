# agents/ — Graphs, Nodes, and the Chain Contract

**Owner: Person B (Stream B).** Branch prefix `feat/b-<slug>`. Read the root
`CLAUDE.md` first — this file assumes you already have §2 (rules), §4 (the
chain idea), and §5 (ownership) in your head.

---

## 1. Purpose

`agents/` holds every LangGraph graph and node Doombot runs. There are, and
will only ever be, **two graphs**:

| Graph | File | Status | Trigger |
|---|---|---|---|
| PR review | `agents/orchestrator.py` | **EXISTING — behavior preserved** | a PR is opened/updated |
| Issue triage | `agents/triage_graph.py` | **NEW — you are building this** | an issue is opened |

### Why two graphs instead of one graph with a conditional branch

It is tempting to merge these into one `StateGraph(GraphState)` with a router
node that branches on `"pr_number" in state` vs `"issue_number" in state`.
Don't. Two reasons, both load-bearing:

1. **The node sets are genuinely disjoint.** `fetcher`/`reviewer`/
   `test_writer`/`summarizer` share nothing in common with
   `issue_fetcher`/`duplicate_detector`/`security_scanner`/`impact_scorer`/
   `labeler`/`decider` except the state container. A conditional branch would
   just be dead-code routing around two unrelated pipelines glued into one
   file.
2. **A shared branch forces every field optional for both paths.** The
   moment PR fields and issue fields live in one linear graph, every node has
   to defensively check which world it's in. `GraphState` is already
   `total=False` (see §2) — that's fine for *storage*, but a single graph
   would mean *execution* logic also has to guard against the wrong half of
   the state being populated. Two graphs mean each graph only ever sees the
   keys it declared it needs.

The practical payoff: **you can build the entire triage graph without
touching `agents/orchestrator.py`, `agents/fetcher.py`, `agents/reviewer.py`,
`agents/test_writer.py`, or `agents/summarizer.py`.** Those files work today.
Do not "clean them up" while you're in here — see §7 for the two bugs you
*are* asked to fix, and nothing else.

---

## 2. `GraphState` — the shared TypedDict

`agents/state.py` is **shared, change only by announcement** (root
`CLAUDE.md` §5). It backs both graphs. Every field is optional
(`total=False`) because no single node touches every key — LangGraph only
requires that a node's return dict be a subset of the schema.

```python
from typing import Annotated
from operator import add
from typing_extensions import TypedDict

class GraphState(TypedDict, total=False):
    # --- PR review graph (existing, do not change semantics) ---
    repo_name: str                                  # "owner/repo", set by the caller
    pr_number: int                                   # PR being reviewed
    pr_metadata: dict                                # title/body/state/username from get_pr_details_mcp
    diff_files: list[dict]                           # [{"name": ..., "differences": <unified diff>}]
    review_metadata: Annotated[list[dict], add]      # reviewer findings; add-reducer so re-entrant appends accumulate
    test_metadata: str                               # FIXED: was `list`, is actually LLM prose. One node writes it once.
    summary_metadata: str                            # final PR review comment text

    # --- Issue triage graph (new) ---
    investigation_id: str                            # UUID assigned by the API layer before invoking issue_app
    issue_number: int                                # issue being triaged
    issue_metadata: dict                              # title/body/labels/reactions/comments/author/created_at from get_issue_mcp
    duplicates: list[dict]                            # [{"number": int, "score": float, "relation": "duplicate"|"related"}]
    security_findings: list[dict]                     # [{"keyword": str, "context": str}] (layer 1); LLM-confirmed subset if layer 2 ships
    impact_score: int                                 # 0-100, computed by impact_scorer
    labels: list[str]                                 # labels chosen by labeler (may be "suggested" — see labeler contract)
    decision: dict                                    # {"action": ..., "reason": ..., "confidence": float} from decider
    chain: Annotated[list[dict], add]                 # StepRecord log; add-reducer because every node appends exactly one record
```

**Note the `test_metadata: str` fix.** The field was declared `list` in
`agents/state.py` but `agents/test_writer.py` has always written a single
LLM string (`result.content`) to it, and `agents/summarizer.py` reads it as a
string. The declared type was simply wrong. Correcting it to `str` is a type
annotation fix with zero behavior change — it does not touch either node's
logic.

**`review_metadata` and `chain` use the `add` reducer deliberately.** Both
are append-only logs contributed to by potentially more than one node
invocation. Every other field is last-write-wins, which is LangGraph's
default merge behavior for a plain (non-Annotated) key.

---

## 3. THE `chain_step` CONTRACT

This is the most important section in this document. Get it wrong and the
live streaming, SQLite persistence, and refresh-proof replay described in
root `CLAUDE.md` §4 all silently break at once, because they all come from
this one decorator.

File: `agents/chain.py`.

### 3.1 Rule zero

**Nodes never import `memory/` or `api/`.** Not for logging, not for a
"quick debug insert," not for anything. If a node needs to persist or
broadcast something, that's a sign the decorator is missing a hook, not a
reason to reach into another stream's package. This boundary is what lets
Stream A build persistence/`api/` and Stream B build nodes in parallel
without merge conflicts.

### 3.2 Decorator signature

```python
def chain_step(name: str, title: str):
    """Wrap a LangGraph node so it emits a StepRecord and appends it to state["chain"].

    Args:
        name: stable machine identifier for this node, e.g. "issue_fetcher".
              Matches the LangGraph node name registered in the graph.
        title: human-readable label shown in the dashboard's live chain view,
               e.g. "Fetching issue #{issue_number}".

    The wrapped node's signature is unchanged: `def node(state: GraphState) -> dict`.
    The decorator does not change what the node receives; it changes what
    happens to what the node returns.
    """
```

Usage at a node call site:

```python
from agents.chain import chain_step

@chain_step("issue_fetcher", "Fetching issue")
def issue_fetcher_node(state: GraphState) -> dict:
    ...
    return {"issue_metadata": metadata}, [{"type": "issue", "ref": str(issue_number), "score": None, "snippet": title}]
```

### 3.3 What a node author returns

A decorated node returns **either**:

- `patch: dict` — a partial `GraphState` update, **or**
- `(patch: dict, evidence: list[dict])` — the same, plus evidence items to
  attach to this step.

Nodes never construct a `StepRecord` themselves and never call
`get_stream_writer()` themselves. That is entirely the decorator's job.

### 3.4 What the decorator does, in order

1. Look up (or assign) `seq` — the next sequence number for this
   `investigation_id`, via a helper `_next_seq(state) -> int` (implementation
   detail: derive it from `len(state.get("chain", []))`, since `chain` is the
   authoritative append-only log for this run).
2. Build a `running` `StepRecord` and emit it via `get_stream_writer()`
   **before** calling the wrapped node (`step.started`).
3. Start a timer with `time.perf_counter()`.
4. Call the wrapped node function with `state`.
5. Normalize the return value with `_split(result) -> tuple[dict, list[dict]]`
   — accepts either `patch` or `(patch, evidence)` and always returns both,
   defaulting `evidence` to `[]`.
6. On success: stop the timer, build the `done` `StepRecord`, emit it via
   `get_stream_writer()` (`step.completed`), and return
   `{**patch, "chain": [rec]}` — note only the **one** new record is
   returned; the `add` reducer on `state["chain"]` is what accumulates the
   full log across nodes. Never return `state["chain"] + [rec]` — that
   double-appends under the reducer.
7. On exception: stop the timer, build an `error` `StepRecord` (status
   `"error"`, `output_summary` set from `str(exc)`), emit it via
   `get_stream_writer()`, **then re-raise**. The decorator observes and
   reports the failure; it does not swallow it. LangGraph's own run-level
   error handling takes it from there.

```python
import time
from langgraph.config import get_stream_writer

def chain_step(name: str, title: str):
    def decorator(fn):
        def wrapped(state: GraphState) -> dict:
            writer = get_stream_writer()
            seq = _next_seq(state)
            rec = _base_record(state, seq, name, title)
            rec["status"] = "running"
            writer({"type": "step.started", "step": rec})
            start = time.perf_counter()
            try:
                result = fn(state)
                patch, evidence = _split(result)
            except Exception as exc:
                rec = {**rec, "status": "error", "output_summary": str(exc),
                       "duration_ms": int((time.perf_counter() - start) * 1000)}
                writer({"type": "step.completed", "step": rec})
                raise
            rec = {**rec, "status": "done", "evidence": evidence,
                   "duration_ms": int((time.perf_counter() - start) * 1000)}
            writer({"type": "step.completed", "step": rec})
            return {**patch, "chain": [rec]}
        return wrapped
    return decorator
```

The snippet above is a **shape**, not a mandate on every helper name —
`_next_seq`, `_base_record`, and `_split` are the three helpers this file
needs; keep those three names since `docs/ARCHITECTURE.md` and Stream A's
persistence code may reference them.

### 3.5 `StepRecord` — exact shape

```python
StepRecord = {
    "step_id": str,            # uuid4, unique per record
    "investigation_id": str,   # from state["investigation_id"]; "" for the PR graph (no investigation concept there yet)
    "seq": int,                # 0-based order within this run
    "name": str,                # decorator's `name` arg, e.g. "duplicate_detector"
    "title": str,                # decorator's `title` arg, may be templated with state values
    "status": "running" | "done" | "error",
    "input_summary": str,        # short, human string describing what the node was given (e.g. "issue #42")
    "output_summary": str,       # short, human string describing what the node produced, or the exception message on error
    "evidence": list[dict],      # see §3.6; [] for the "running" record, populated for "done"
    "duration_ms": int,           # wall time in the node, 0 for the "running" record
    "started_at": str,            # ISO-8601 UTC timestamp
    "ended_at": str | None,       # ISO-8601 UTC timestamp, None for the "running" record
}
```

### 3.6 Evidence item — exact shape

```python
Evidence = {
    "type": "issue" | "pr" | "file" | "rule",
    "ref": str,      # identifier: issue/PR number as string, file path, or rule/keyword name
    "score": float | None,   # similarity or confidence score if applicable, else None
    "snippet": str,           # short quoted text backing the claim (title, diff line, matched keyword context)
}
```

`type: "rule"` is for `security_scanner`'s keyword-list hits (`ref` = the
keyword, `snippet` = the surrounding text). `type: "issue"`/`"pr"` are for
`duplicate_detector` citing other issues/PRs. `type: "file"` is for anything
citing repo file content.

---

## 4. The triage graph — node by node

All six live in `agents/triage/`. Each file exports exactly one
`*_node(state: GraphState) -> dict | tuple[dict, list[dict]]` function,
decorated with `@chain_step`.

### 4.1 `issue_fetcher`

- **File:** `agents/triage/issue_fetcher.py`
- **Reads:** `repo_name`, `issue_number`
- **Writes:** `issue_metadata`
- **Does:** spawns the shared MCP client (same `StdioServerParameters`
  pattern as `agents/fetcher.py`) and calls the `GET_ISSUE` tool
  (`mcp_server/tool_names.py`) with `{repo_name, issue_number}`. Parses the
  JSON result into `issue_metadata`. This is the entry point of the graph —
  no upstream node populates `issue_metadata` for it.
- **`chain_step` title:** `"Fetching issue #{issue_number}"`

### 4.2 `duplicate_detector`

- **File:** `agents/triage/duplicate_detector.py`
- **Reads:** `repo_name`, `issue_number`, `issue_metadata`
- **Writes:** `duplicates`
- **Does:** builds a query string from `issue_metadata` (title + body, same
  shape as `find_duplicates` expects — see `rag/CLAUDE.md`) and calls
  `rag.retriever.find_duplicates(issue_text, repo_name, exclude_number=issue_number)`.
  Buckets results by score:
  - `score > 0.85` -> `relation: "duplicate"`
  - `0.65 <= score <= 0.85` -> `relation: "related"`
  - below 0.65 -> dropped, not included in `duplicates`
- **CRITICAL:** must pass `exclude_number=issue_number` through to
  `find_duplicates`. Without it, the issue being triaged is indexed in its
  own `{repo}-issues` collection and will always come back as its own
  nearest neighbor at score 1.0 — every issue becomes "a duplicate of
  itself." This is the single easiest bug to introduce in this node; see
  `rag/CLAUDE.md` §"find_duplicates" for the exclusion contract on the RAG
  side.
- **`chain_step` title:** `"Searching for duplicate issues"`

### 4.3 `security_scanner`

- **File:** `agents/triage/security_scanner.py`
- **Reads:** `issue_metadata`
- **Writes:** `security_findings`
- **Does — Layer 1 (MUST-HAVE, build this first):** deterministic,
  case-insensitive keyword match over `issue_metadata["title"] + " " +
  issue_metadata["body"]`. Use exactly this keyword list:

  ```python
  SECURITY_KEYWORDS = [
      "xss", "sql injection", "csrf", "ssrf", "rce", "bypass",
      "vulnerability", "exploit", "auth", "authentication", "authorization",
      "overflow", "traversal", "secret", "token", "api key", "password",
      "credential",
  ]
  ```

  For each keyword found, emit one entry to `security_findings`:
  `{"keyword": kw, "context": <~80 chars of surrounding text>}`. Also surface
  each as a `type: "rule"` evidence item (§3.6).

- **Does — Layer 2 (CUT unless ahead of schedule):** an LLM pass
  (`ChatGroq`, see §5) that takes the Layer-1 keyword hits and confirms
  whether each is a genuine security concern versus an incidental mention
  (e.g., "auth" in "I need help configuring auth for my fork" is *not* a
  finding). If you build this, it narrows `security_findings` to the
  confirmed subset — it never adds findings Layer 1 didn't already surface.
  **Do not start Layer 2 until Layer 1 is merged and working end-to-end.**

- **`chain_step` title:** `"Scanning for security concerns"`

### 4.4 `impact_scorer`

- **File:** `agents/triage/impact_scorer.py`
- **Reads:** `issue_metadata`, `duplicates`, `security_findings`
- **Writes:** `impact_score` (int, 0-100)
- **Does:** combines signals from `issue_metadata` — reaction/upvote count,
  comment count, distinct participant count, issue age (older + still open
  can mean either "stale" or "long-standing pain," weight accordingly),
  existing labels (e.g. a pre-existing `bug` or `regression` label raises
  the score) — into a single 0-100 score. A non-empty `security_findings`
  should push the score up (security issues are high-impact by default);
  a `duplicates` entry with `relation: "duplicate"` should push it down
  (don't rank a dup as urgent). Exact weighting is your call — document
  whatever formula you land on in the function's docstring so `decider` and
  the dashboard's tooltip copy can describe it accurately.
- **`chain_step` title:** `"Scoring impact"`

### 4.5 `labeler`

- **File:** `agents/triage/labeler.py`
- **Reads:** `issue_metadata`, `duplicates`, `security_findings`
- **Writes:** `labels`
- **Does:** classifies the issue (bug / feature / question / security /
  duplicate / stale, etc.) and picks candidate GitHub labels. Confidence
  threshold is **0.85**:
  - confidence `>= 0.85` -> **auto-apply**: the labels go into `labels` and
    `decider` will call `ADD_LABELS` for real.
  - confidence `< 0.85` -> **suggest only**: still populate `labels`, but
    tag the result (e.g. an extra `labels_confidence` note in evidence, or a
    `suggested: true` marker your implementation defines) so `decider` knows
    not to apply them automatically — a human approves first.
  This node never calls GitHub itself; it only decides what *would* be
  applied. `decider` is the only node with GitHub side effects (§4.6).
- **`chain_step` title:** `"Classifying and labeling"`

### 4.6 `decider`

- **File:** `agents/triage/decider.py`
- **Reads:** `duplicates`, `security_findings`, `impact_score`, `labels`
- **Writes:** `decision` (`{"action": str, "reason": str, "confidence": float}`)
- **Does:** the terminal node. Picks exactly one action:
  - `"escalate"` — security finding, or high impact score, or otherwise
    needs a maintainer's eyes. Posts nothing destructive; typically just
    applies labels and leaves a comment flagging it for review.
  - `"comment"` — posts an automated comment via `POST_ISSUE_COMMENT` (e.g.
    acknowledging the issue, linking related issues).
  - `"close_duplicate"` — a `duplicates` entry has `relation: "duplicate"`
    with high confidence; posts a comment linking the original and applies
    the `ADD_LABELS` tool with a `duplicate` label. **Only** Stream B's
    explicit choice to close (vs. just labeling) should ever actually close
    the issue via the GitHub client — if the underlying `github_client`
    function to close an issue doesn't exist yet, `decider` suggests the
    action and comments, but does not silently no-op the "close" part.
  - `"no_action"` — nothing rises to the other three; still recorded so the
    dashboard can show "triaged, no action needed" instead of looking stuck.
  This is the **only** node in the triage graph that performs real GitHub
  side effects, via the same MCP-spawn pattern used elsewhere
  (`mcp_server/tool_names.py` constants: `POST_ISSUE_COMMENT`, `ADD_LABELS`).
- **`chain_step` title:** `"Deciding next action"`

### 4.7 Graph wiring

```python
# agents/triage_graph.py
from langgraph.graph import StateGraph, START, END
from agents.state import GraphState
from agents.triage.issue_fetcher import issue_fetcher_node
from agents.triage.duplicate_detector import duplicate_detector_node
from agents.triage.security_scanner import security_scanner_node
from agents.triage.impact_scorer import impact_scorer_node
from agents.triage.labeler import labeler_node
from agents.triage.decider import decider_node

graph = StateGraph(GraphState)
graph.add_node("issue_fetcher", issue_fetcher_node)
graph.add_node("duplicate_detector", duplicate_detector_node)
graph.add_node("security_scanner", security_scanner_node)
graph.add_node("impact_scorer", impact_scorer_node)
graph.add_node("labeler", labeler_node)
graph.add_node("decider", decider_node)

graph.add_edge(START, "issue_fetcher")
graph.add_edge("issue_fetcher", "duplicate_detector")
graph.add_edge("duplicate_detector", "security_scanner")
graph.add_edge("security_scanner", "impact_scorer")
graph.add_edge("impact_scorer", "labeler")
graph.add_edge("labeler", "decider")
graph.add_edge("decider", END)

issue_app = graph.compile()
```

Purely linear, same style as `agents/orchestrator.py`'s `app`. No
conditional edges in v1 — if impact/priority routing is wanted later, that's
a follow-up PR, not part of this contract.

---

## 5. Groq / LLM usage convention

Every node or tool that needs an LLM call follows this pattern — **do not**
instantiate `ChatGroq` at import time inside a triage module the way
`agents/reviewer.py` and `agents/summarizer.py` currently do at module scope.
For the new triage nodes, construct it lazily inside the function that needs
it, reading the model name from the environment:

```python
import os
from langchain_groq import ChatGroq

def _get_llm() -> ChatGroq:
    """Lazily construct the shared Groq chat model.

    Lazy construction means importing agents.triage.security_scanner (e.g.
    for a unit test that never calls the LLM path) doesn't require
    GROQ_API_KEY to be set. Reads the model name from GROQ_MODEL so it can
    be swapped without a code change if Groq deprecates a model mid-event.
    """
    model_name = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    return ChatGroq(model=model_name)
```

Do not retrofit this into `agents/reviewer.py` or `agents/summarizer.py` as
part of this work — those are existing, working files outside this task's
scope (see §7). New triage code follows the lazy pattern from day one.

---

## 6. Known bugs you must fix

Both are **name-drift bugs**: the MCP call site uses a string that doesn't
match what's registered in `mcp_server/tools.py`. Root `CLAUDE.md` rule 5
exists because of exactly these two.

| File | Line (approx) | Wrong string | Correct constant | From `mcp_server/tool_names.py` |
|---|---|---|---|---|
| `agents/summarizer.py` | `session.call_tool("post_review_comment", ...)` | `"post_review_comment"` | `POST_COMMENT` | `"post_review_comment_mcp"` |
| `agents/reviewer.py` | `session.call_tool("get_file_content", ...)` | `"get_file_content"` | `GET_FILE_CONTENT` | `"get_file_content_mcp"` |

Fix both by importing the constants:

```python
from mcp_server.tool_names import POST_COMMENT, GET_FILE_CONTENT
...
result = await session.call_tool(POST_COMMENT, {...})
```

This is a one-line-per-call-site fix. Do not restructure either file's
control flow while you're in there — the surrounding async/MCP boilerplate
is out of scope and works today.

---

## 7. Files you may create or modify

**Create / implement (contract above governs each):**
- `agents/chain.py`
- `agents/triage_graph.py`
- `agents/triage/issue_fetcher.py`
- `agents/triage/duplicate_detector.py`
- `agents/triage/security_scanner.py`
- `agents/triage/impact_scorer.py`
- `agents/triage/labeler.py`
- `agents/triage/decider.py`
- `agents/triage/__init__.py` (package marker only)

**Modify (narrow, listed changes only):**
- `agents/state.py` — extend `GraphState` per §2; this is a **shared** file,
  announce the change per root `CLAUDE.md` §5 before merging.
- `agents/summarizer.py` — the one-line tool-name fix in §6, nothing else.
- `agents/reviewer.py` — the one-line tool-name fix in §6, nothing else.

## 8. Do not touch

- `agents/orchestrator.py`, `agents/fetcher.py`, `agents/test_writer.py` —
  working, in scope for zero changes.
- `api/`, `memory/` — Stream A. Nodes must never import from these (§3.1).
- `mcp_server/client.py`, `mcp_server/tool_names.py` — Stream A owns these;
  you only *add new constants* to `tool_names.py` if a triage tool needs one
  that doesn't exist yet, and you announce it first (it's a shared file).
- `mcp_server/github_client.py`, `mcp_server/tools.py` — these ARE yours per
  root `CLAUDE.md` §5, but they're documented in `mcp_server/CLAUDE.md`, not
  here. Don't add GitHub client functions from inside an `agents/` PR without
  cross-referencing that doc.

---

## 9. Verification

```bash
# GraphState imports and both graphs compile
python -c "from agents.orchestrator import app; from agents.triage_graph import issue_app; print('ok')"

# chain_step round-trips patch + evidence without touching memory/api
python -c "
from agents.chain import chain_step

@chain_step('demo', 'Demo step')
def demo_node(state):
    return {'labels': ['demo']}, [{'type': 'rule', 'ref': 'demo', 'score': None, 'snippet': 'x'}]

out = demo_node({'chain': []})
assert out['labels'] == ['demo']
assert len(out['chain']) == 1
assert out['chain'][0]['status'] == 'done'
print('chain_step ok')
"

# duplicate_detector excludes its own issue number (adjust import path to your implementation)
python -c "
from agents.triage.duplicate_detector import duplicate_detector_node
print('imports ok — run this against a real repo before merging')
"

# tool name fix
python -c "
import ast, sys
for path in ('agents/summarizer.py', 'agents/reviewer.py'):
    src = open(path).read()
    assert 'post_review_comment\"' not in src.replace('post_review_comment_mcp', '')
print('no stale tool-name literals')
"
```

Every node file should also be importable standalone without a live GitHub
token or Groq key (i.e., imports must not eagerly instantiate `ChatGroq` or
open a GitHub session at module scope) — see §5.

---

## 10. Task breakdown

| Task | File | Branch | Depends on |
|---|---|---|---|
| Extend shared state | `agents/state.py` | `feat/b-triage-state` | — |
| Chain-step decorator | `agents/chain.py` | `feat/b-chain-step` | `feat/b-triage-state` |
| Fix tool-name drift | `agents/summarizer.py`, `agents/reviewer.py` | `fix/b-mcp-tool-names` | — |
| Issue fetcher node | `agents/triage/issue_fetcher.py` | `feat/b-issue-fetcher` | `feat/b-chain-step` |
| Duplicate detector node | `agents/triage/duplicate_detector.py` | `feat/b-duplicate-detector` | `feat/b-chain-step`, `rag` `find_duplicates` |
| Security scanner node (Layer 1) | `agents/triage/security_scanner.py` | `feat/b-security-scanner` | `feat/b-chain-step` |
| Impact scorer node | `agents/triage/impact_scorer.py` | `feat/b-impact-scorer` | `feat/b-chain-step` |
| Labeler node | `agents/triage/labeler.py` | `feat/b-labeler` | `feat/b-chain-step` |
| Decider node | `agents/triage/decider.py` | `feat/b-decider` | `feat/b-chain-step`, `mcp_server` label/comment tools |
| Wire the graph | `agents/triage_graph.py` | `feat/b-triage-graph` | all six nodes above |

The six node PRs are independent of each other once `chain.py` and
`state.py` are merged — dispatch them as parallel Sonnet subagents per root
`CLAUDE.md` §3. `triage_graph.py` is the integration point and should be the
last thing merged.

---

## 11. Definition of done

- [ ] `GraphState` extended exactly as in §2, `test_metadata` corrected to `str`
- [ ] `agents/chain.py` implements `chain_step`, `_next_seq`, `_split` per §3
- [ ] Every triage node returns `(patch, evidence)` or `patch`, never touches
      `memory/` or `api/`
- [ ] `duplicate_detector` excludes the issue's own number (§4.2)
- [ ] `security_scanner` Layer 1 uses the exact keyword list in §4.3
- [ ] `labeler` respects the 0.85 auto-apply threshold
- [ ] `decider` is the only node making real GitHub calls
- [ ] Both tool-name bugs in §6 fixed via `mcp_server/tool_names.py` constants
- [ ] `issue_app = graph.compile()` wired exactly per §4.7
- [ ] All verification commands in §9 run clean
- [ ] `agents/orchestrator.py` and its four existing node files unchanged
