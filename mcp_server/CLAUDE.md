# mcp_server/ — MCP tool surface and GitHub client

**This folder has a split ownership. Read this section before editing anything.**

| Files | Owner | Branch prefix |
|---|---|---|
| `mcp_server/client.py`, `mcp_server/tool_names.py` | **Person A** (Stream A) | `feat/a-<slug>` |
| `mcp_server/github_client.py`, `mcp_server/tools.py` | **Person B** (Stream B) | `feat/b-<slug>` |

`mcp_server/server.py` and `mcp_server/__init__.py` are shared plumbing —
small, stable, and rarely touched; if you need to change them, announce it
regardless of which stream you're on.

Do not cross the line. Person A does not edit `github_client.py` or
`tools.py`. Person B does not edit `client.py` or `tool_names.py`. If your
task needs a change on the other side of the line, say so and hand it off —
don't just do it because it's a two-line fix.

---

## 1. Purpose

`mcp_server/` exposes GitHub operations (read PR/issue data, post comments,
add labels) as MCP tools, callable both as a real MCP stdio server
(`server.py`, verifiable with MCP Inspector) and, for the hackathon's
internal LangGraph agent, via a lightweight in-process client that skips
subprocess overhead entirely.

---

## 2. The tool name registry — never hardcode a tool name string

`mcp_server/tool_names.py` is the single source of truth for tool name
strings. Every call site — agent code, tests, the client — must import the
constant, never write the literal string.

```python
from mcp_server.tool_names import GET_ISSUE, ADD_LABELS
```

**Why this is a hard rule:** in the prototype, tool names were typed as
string literals at both the `@mcp.tool()` registration site and the call
site. Two of the eight prototype bugs were exactly this — a typo or a rename
on one side that the other side didn't get, caught only at runtime when a
tool lookup silently failed. Importing a constant turns that class of bug
into an `ImportError` or a `NameError` at import time, which is a much
better time to find out.

**Currently registered (Stream B, in `tools.py`):**

```python
GET_PR_FILES = "get_pullRequest_files"
GET_FILE_CONTENT = "get_file_content_mcp"
GET_PR_DETAILS = "get_pr_details_mcp"
POST_COMMENT = "post_review_comment_mcp"
```

**To add for triage (Stream B registers in `tools.py`; the constants already
exist in `tool_names.py`):**

```python
GET_ISSUE = "get_issue_mcp"
GET_ISSUES = "get_issues_mcp"
POST_ISSUE_COMMENT = "post_issue_comment_mcp"
ADD_LABELS = "add_labels_mcp"
```

The string value in `tool_names.py` **must** match the `@mcp.tool()`
function's name in `tools.py` exactly — that function name is what MCP uses
as the tool's identity on the wire. When Person B adds
`get_issue_mcp` to `tools.py`, the string in `tool_names.py` was already
written by Person A as `"get_issue_mcp"` — match it, don't invent a new one.

---

## 3. The dual-mode client — `client.py` (Stream A)

Controlled by the `USE_MCP_SUBPROCESS` env var.

**Mode 0 (default, `USE_MCP_SUBPROCESS` unset or `"0"`):** dispatch calls
directly to the corresponding `mcp_server.github_client` function in-process.
Zero subprocess risk, zero re-import cost. `mcp_server/server.py` is left
completely alone and still runs standalone as the demoable MCP surface —
you can point MCP Inspector at it independently of whether the LangGraph
agent is using direct dispatch.

**Mode 1 (`USE_MCP_SUBPROCESS=1`):** spawn a real MCP stdio session as:

```bash
python -m mcp_server.server
```

**Not** `python mcp_server/server.py`. The `-m` form runs the module with the
repo root on `sys.path`, so `mcp_server.tools` and `mcp_server.github_client`
resolve via absolute imports with zero `sys.path` hacks. The bare-script
form only works if your cwd happens to be `mcp_server/`, which is exactly
the fragility that caused import bugs in the prototype (see §6).

**Why two modes exist:** the prototype spawned three subprocesses per
investigation run — one per tool call — and each one re-imported `torch`
and `chromadb` from scratch. That's multiple seconds of dead time per run,
multiplied by every step in the chain. Direct dispatch (mode 0) is what the
demo actually runs on; mode 1 exists so the MCP server can still be
demoed/verified as a real, spec-compliant MCP server via Inspector without
that cost being paid on every graph run.

Both modes present the **same call signature** so nothing above `client.py`
needs to know which mode is active:

```python
async def startup() -> None:
    """Mode 0: no-op (or warm up github_client's cached client — see §5).
    Mode 1: spawn `python -m mcp_server.server` as a subprocess, open the
    stdio MCP session, keep it alive for the process lifetime."""

async def shutdown() -> None:
    """Mode 0: no-op. Mode 1: close the session, terminate the subprocess."""

async def call(tool_name: str, args: dict) -> str:
    """Dispatch to `tool_name` (always a constant from tool_names.py) with
    `args`, return the tool's string result. Mode 0: look up and await/run
    the matching mcp_server.github_client function directly. Mode 1: send
    an MCP tool-call request over the open stdio session."""

def call_tool_sync(tool_name: str, args: dict) -> str:
    """Sync wrapper around `call()`, for the sync LangChain @tool functions
    in agents/reviewer.py (LangChain tools are sync callables; the graph
    itself is async). Implementation runs the coroutine to completion
    (e.g. asyncio.run, or a loop-aware helper if called from within an
    already-running loop)."""
```

---

## 4. `github_client.py` — additions needed (Stream B)

**Preserve these existing functions as-is** (signatures and behavior) —
they are used by the review flow already:

- `git_initialization(repo_name, pr_number)`
- `get_pr_files(repo_name: str, pr_number: int)`
- `get_pr_details(repo_name, pr_number)`
- `get_file_content(repo_name, file_path)`
- `post_review_comment(repo_name, pr_number, comment)`
- `get_repo_files(repo_name)`

**Add these for issue triage:**

```python
def get_issue(repo_name: str, issue_number: int) -> dict:
    """Fetch one issue. Return at least {title, body, state, username,
    labels, number}, mirroring the shape get_pr_details uses for PRs."""

def get_issues(repo_name: str, state: str = "open", limit: int = 30) -> list[dict]:
    """List issues for repo_name filtered by state ('open'/'closed'/'all'),
    capped at `limit` results. Same per-issue shape as get_issue."""

def post_issue_comment(repo_name: str, issue_number: int, comment: str) -> str:
    """Post a comment on the issue. Return the created comment's body,
    mirroring post_review_comment's return convention."""

def add_labels(repo_name: str, issue_number: int, labels: list[str]) -> list[str]:
    """Add the given labels to the issue. Return the issue's full label
    list after the add."""
```

Register each as an `@mcp.tool()` in `tools.py` using the matching constant
from `tool_names.py` (`GET_ISSUE`, `GET_ISSUES`, `POST_ISSUE_COMMENT`,
`ADD_LABELS`) as the function name.

---

## 4b. F18 — the intelligence layer (built)

`tools.py` exposes GitHub **to Doombot**: every tool there is a passthrough.
`intelligence.py` is the other direction — it exposes Doombot's own analysis to
any MCP client, so the protocol runs both ways.

Registered in `mcp_server/intelligence.py`, names in `tool_names.py` under
`INTELLIGENCE_TOOLS`:

| Tool | Backed by | Returns |
|---|---|---|
| `search_issues_mcp` | `rag/retriever.py` | semantic matches with cosine scores |
| `find_duplicates_mcp` | `rag/retriever.py` | duplicate/related buckets + verdict |
| `get_escalations_mcp` | `memory/repo.py` | the open queue, severity and reason |
| `get_health_score_mcp` | `api/health.py` | score, breakdown, `measured`, `unreadable` |
| `get_investigation_mcp` | `memory/repo.py` | one chain replayed, with evidence |
| `list_investigations_mcp` | `memory/repo.py` | recent decisions, to find an id |
| `get_issue_graph_mcp` | `rag/graph.py` | nodes and weighted links |

Three properties that must survive any edit:

- **Read-only, without exception.** No tool here posts, labels, or closes.
  Writes stay behind the decider's approval gates; an external client must not
  route around a maintainer. `tests/test_mcp_intelligence.py` asserts this
  against the source of every registered tool, so adding a write breaks the
  build rather than shipping quietly.
- **`get_health_score_mcp` carries `measured` and `unreadable`, and says so in
  prose.** Three of the four sub-scores return 100 for an empty backlog, so the
  number is 100 exactly when it means least. A client with no dashboard to look
  at needs the sentence, not only the flags.
- **Imports are deferred into each function body.** `rag` pulls in torch and
  chromadb; importing eagerly would make every client pay seconds just to list
  the tools, including clients that only call the SQLite-backed ones.

`server.py` imports both modules — `intelligence` for its registration side
effect. Drop that import and the tools exist but are invisible on the wire.

---

## 4c. Auto-Fix PR — the one write tool outside `tools.py`'s GitHub passthroughs

`auto_fix_issue_mcp`, registered in `tools.py` (not `intelligence.py`) via the
`AUTO_FIX_ISSUE` constant in `tool_names.py`. It is documented here rather than
folded into the table in §4b because it breaks the property that section
opens with: **unlike the seven intelligence tools, it is not read-only.**
Calling it can open a real pull request against the target repository.

| Tool | Backed by | Returns | Read-only? |
|---|---|---|---|
| `auto_fix_issue_mcp` | `agents/triage/auto_fix.py` | attempt result: status, reason, PR details | **No** |

What it costs and does, for a client deciding whether to call it:

- Several GitHub requests per call — reading the issue, locating/reading a
  source PR, committing a candidate fix, opening a PR. Not a lookup; must not
  be called speculatively.
- Any PR it opens is always a **draft**, never auto-merged; a human still
  reviews it.
- Never raises. When it cannot apply a fix, `status` explains why
  (`"not_applicable"`, `"blocked"`, `"no_source_pr"`, `"error"`, ...) via a
  `reason` field, instead of throwing.
- `source_pr=0` means "not known, find it" — the tool translates that to
  `None` before calling `agents.triage.auto_fix.auto_fix_issue`, since MCP
  tool schemas are cleaner without `Optional` parameters.
- Deliberately excluded from `INTELLIGENCE_TOOLS` in `tool_names.py` — that
  tuple is asserted read-only by `tests/test_mcp_intelligence.py`, and this
  tool writes.
- Same deferred-import discipline as §4b: `agents.triage.auto_fix` reaches
  into `rag`, which pulls in torch and chromadb, so the import happens inside
  the function body, not at module scope.

---

## 5. The shared client — resolved, and why it is configured as it is

This section previously described a fresh `Github(github_token)` per call as an
open problem. It is fixed: there are no inline constructions left, and the dead
`from github import Auth` is gone. `_get_client()` caches one module-level
client.

What matters now is **how** it is configured, because the defaults are actively
harmful for anything with a user waiting:

```python
Github(
    github_token,
    retry=Retry(total=2, backoff_factor=0.4,
                status_forcelist=[500, 502, 503, 504]),
    per_page=100,
    timeout=20,
)
```

- **A plain `urllib3.Retry`, not PyGithub's `GithubRetry`.** On a 403 rate
  limit `GithubRetry` *sleeps inside the call* until the quota window resets.
  Observed: `Setting next backoff to 1524.97s` — a 25-minute sleep with the
  request still open, which made adding a repository appear to hang forever and
  logged nothing, because uvicorn logs on completion. A plain retry keeps the
  useful part (a couple of attempts at transient 5xx) and lets a rate limit
  raise in ~0.5s so the caller can report it.
- **`per_page=100`, not the default 30.** Request count is what exhausts the
  5000/hour quota, and the default triples it for identical data.

Callers should surface `RateLimitExceededException` as a 429 with the reset
time. Retrying it silently is how a demo dies.

---

## 6. Import path fix — absolute imports required

`tools.py` currently does:

```python
from github_client import get_pr_files, get_file_content, get_pr_details, post_review_comment
```

and `server.py` does:

```python
from tools import mcp
```

These are **bare imports** that only resolve if the process's cwd (or
`sys.path[0]`) happens to be `mcp_server/` itself. Run `uvicorn api.main:app`
from the repo root, or run `python -m mcp_server.server` from the repo root
(the correct invocation per §3), and these bare imports fail with
`ModuleNotFoundError: No module named 'github_client'`.

**Fix — make every intra-package import absolute:**

```python
# tools.py
from mcp_server.github_client import (
    get_pr_files, get_file_content, get_pr_details, post_review_comment,
    get_issue, get_issues, post_issue_comment, add_labels,
)

# server.py
from mcp_server.tools import mcp
```

This is what makes `python -m mcp_server.server` (§3, mode 1) work
correctly from the repo root with no `sys.path` manipulation anywhere.

---

## 7. Rate limiting guidance (PyGithub)

The GitHub REST API allows 5,000 authenticated requests/hour per token —
plenty for a hackathon demo, but a chatty retry loop or an unbounded
`get_repo_files` walk over a huge repo can burn through headroom fast
during rehearsal.

- Check remaining quota cheaply: `g.get_rate_limit().core.remaining`.
- `get_issues(..., limit=...)` exists specifically to cap how many issues
  get pulled per call — always pass a sane `limit` (the default of 30 is
  intentional), never fetch "all issues" during a live demo path.
- If a call raises `github.RateLimitExceededException`, do not silently
  retry in a tight loop — surface the error up so the caller (agent node or
  route) can decide whether to fall back to seeded/demo data
  (see `scripts/CLAUDE.md`'s `DEMO_MODE`).
- Prefer conditional/targeted fetches (`get_issue(number)`) over broad scans
  (`get_issues()`) inside the per-investigation hot path; reserve broad
  scans for indexing/health-scoring background jobs.

---

## 8. Verification

**With MCP Inspector** (validates `server.py` as a real MCP server,
independent of which client mode is active):

```bash
npx @modelcontextprotocol/inspector python -m mcp_server.server
```

Open the Inspector UI and confirm **17** tools are listed: the 9 GitHub
passthroughs (`get_pullRequest_files`, `get_file_content_mcp`,
`get_pr_details_mcp`, `post_review_comment_mcp`, `get_issue_mcp`,
`get_issues_mcp`, `post_issue_comment_mcp`, `get_issue_comments_mcp`,
`add_labels_mcp`), the 7 intelligence tools in §4b, and
`auto_fix_issue_mcp` from §4c. Call one read-only
tool (e.g. `get_issue_mcp`) against a real public repo to confirm the
response shape.

The intelligence tools need no network, so they are the cheapest thing to
demo: `get_escalations_mcp` and `list_investigations_mcp` read SQLite only.
Do **not** call `auto_fix_issue_mcp` to try the surface out -- it is the one
registered tool that opens a real pull request (§4c).

**Direct Python call** (validates `github_client.py` functions without MCP
in the loop at all):

```bash
python -c "
from mcp_server.github_client import get_issue
print(get_issue('octocat/Hello-World', 1))
"
```

**Direct dispatch mode of the client** (validates `client.py` mode 0):

```bash
python -c "
import asyncio
from mcp_server.client import call_tool_sync
from mcp_server.tool_names import GET_ISSUE
print(call_tool_sync(GET_ISSUE, {'repo_name': 'octocat/Hello-World', 'issue_number': 1}))
"
```

---

## 9. Task breakdown

| Task | File(s) | Owner | Branch |
|---|---|---|---|
| Add 4 triage tool name constants | `mcp_server/tool_names.py` | A | `feat/a-mcp-tool-names-triage` |
| Dual-mode client (startup/shutdown/call/call_tool_sync) | `mcp_server/client.py` | A | `feat/a-mcp-client` |
| Fix bare imports to absolute | `mcp_server/tools.py`, `mcp_server/server.py` | B | `feat/b-mcp-absolute-imports` |
| Cache module-level Github client, drop unused `Auth` import | `mcp_server/github_client.py` | B | `feat/b-mcp-cached-client` |
| Add `get_issue`, `get_issues`, `post_issue_comment`, `add_labels` | `mcp_server/github_client.py` | B | `feat/b-mcp-triage-functions` |
| Register the 4 new tools in FastMCP | `mcp_server/tools.py` | B | `feat/b-mcp-triage-tools` |

---

## Definition of done

- [ ] No call site anywhere in the repo writes a tool-name string literal — all import from `tool_names.py`
- [ ] All 8 tool name constants exist and match `@mcp.tool()` function names exactly
- [ ] `client.py` exposes `startup`, `shutdown`, `call`, `call_tool_sync` with the exact signatures in §3
- [ ] `USE_MCP_SUBPROCESS=1` spawns `python -m mcp_server.server`, not the bare script path
- [ ] `tools.py` and `server.py` use absolute `mcp_server.` imports only
- [ ] `github_client.py` caches one `Github` client at module level; no per-call `Github(token)` construction remains
- [ ] Unused `from github import Auth` import removed
- [ ] `get_issue`, `get_issues`, `post_issue_comment`, `add_labels` implemented and registered as MCP tools
- [ ] Existing 6 functions (`git_initialization`, `get_pr_files`, `get_pr_details`, `get_file_content`, `post_review_comment`, `get_repo_files`) unchanged in signature/behavior
- [ ] MCP Inspector lists all 8 tools and a read-only call succeeds
- [ ] Direct `python -c` call against `github_client.py` succeeds without importing MCP at all
