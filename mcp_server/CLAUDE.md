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

## 5. Known issue: fresh `Github(token)` per call

Every function in `github_client.py` currently does `Github(github_token)`
inline. That's a new HTTP client (and, depending on PyGithub version, a
fresh connection pool) built on every single call, including the loop in
`get_repo_files` and every review comment. Under load — or during a
demo where the agent chains 5+ calls per investigation — this is wasted
setup cost for no benefit, since the token doesn't change.

**Fix:** cache a module-level client and reuse it:

```python
_client: Github | None = None

def _get_client() -> Github:
    global _client
    if _client is None:
        _client = Github(github_token)
    return _client
```

Then replace every `g = Github(github_token)` call site with
`g = _get_client()`. `git_initialization` should do the same.

Also: `from github import Auth` is imported at the top of `github_client.py`
and **never used**. Remove it as part of this same cleanup — dead imports
are exactly the kind of thing that looks intentional to the next person who
touches the file and isn't.

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

Open the Inspector UI, confirm all 8 tools are listed
(`get_pullRequest_files`, `get_file_content_mcp`, `get_pr_details_mcp`,
`post_review_comment_mcp`, `get_issue_mcp`, `get_issues_mcp`,
`post_issue_comment_mcp`, `add_labels_mcp`), and call one read-only tool
(e.g. `get_issue_mcp`) against a real public repo to confirm the response
shape.

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
