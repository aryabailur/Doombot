# Handoff — RepoGuardian / Doombot

**Branch:** `feat/a-core-api-and-dashboard` (not merged to `main` — see git status below)
**Session date:** 2026-08-20

> **⚠️ Addendum — read this first.** Everything below §1-§5 describes the
> state of the repo **as of the end of my session**. Since then, the
> working tree has kept changing — `memory/db.py`, `api/schemas.py`,
> `mcp_server/client.py`, `mcp_server/github_client.py`, `mcp_server/
> tools.py`, and `memory/repo.py` all show further edits I did not make
> and have not reviewed line-by-line. From a `git diff --stat` skim, this
> looks like real, substantial follow-on work — not noise:
> - a `suggested_actions` table + migration (`memory/db.py`) and an
>   Approval Center page/nav entry — looks like the "approve labels below
>   the auto-apply threshold" flow this doc's Approval Action Center
>   component always assumed but never had a backend for
> - `tool_calls_json` tracking on `chain_steps` — a new per-step field
>   (`StepRecord.tool_calls`) not in my original schema
> - `HealthForecast`, `MemoryQueryResult`/`MemoryQueryResponse`,
>   `ActivityEvent` schemas added to `api/schemas.py` — this directly
>   matches what §5.2/§5.3 below called out as missing (real Project
>   Memory retrieval endpoint, persistent Agent Activity log), so
>   whoever picked this up seems to be working the same punch list
> - `find_recent_open_investigation` + investigation dedup logic in
>   `api/routes_investigations.py` — guards against the double-card bug
>   visible in one of my own test screenshots earlier in this session
>
> **Do not treat §2-§5 as the current file contents** — treat them as
> the last state I personally verified. Before acting on anything below,
> re-run `git status` / `git diff` and re-verify the servers still behave
> as described, since real hands (or another agent) have been in this
> code since I wrote it.

---

## 1. The goal

Make **Doombot** (backend agent name) / **RepoGuardian** (dashboard product name) —
a GitHub issue-triage agent — actually work end-to-end against **any real
external repository**, with every stage of analysis (fetch → duplicate
detection → security scan → impact score → labeling → decision) visibly
shown and correct on a live dashboard. Not a demo with seeded/fixture data —
real GitHub reads and writes, real RAG-based duplicate detection, real
decisions, all driven from a repo picker the user can point at anything.

Two earlier phases got us here:
1. Backend contract build (FastAPI + SQLite + LangGraph triage pipeline),
   verified against mocked GitHub calls.
2. A full dashboard rebuild (neo-brutalist, then re-skinned to match a
   "Calm Control Room" design spec) — originally on `seed.ts` fixture data,
   then rewired to call the real API.

This session's focus: plug in **real GitHub + Groq credentials** and make
the whole pipeline actually correct against real, external, popular repos
(not just the two tiny sandbox repos used earlier).

---

## 2. Current state — what works right now

Both servers are running as of end of session:
- API: `uvicorn api.main:app --port 8000` (background, pid visible via `lsof -ti:8000`)
- Dashboard: `npm run dev` in `dashboard/` (background, port 5173)

**Verified working, live, with real credentials, against real external repos:**
- `octocat/Hello-World` — full pipeline, read-only (no write access, expected)
- `aryabailur/Doombot` (repo owner's own repo) — full pipeline including
  **real writes**: `security-sensitive` and `duplicate` labels actually
  applied on GitHub, a real duplicate-detection comment actually posted
- `expressjs/express` — a real, busy, external repo with a genuine
  CVE-referenced security issue (#7391), correctly detected as `escalate`
  at 85% confidence with `#cve`/`#dos`/`#fails open` evidence, no false
  positives

**Dashboard pages confirmed showing real (non-fixture) data:** Command
Center, Attention Queue, Issue Detail (with live evidence graph + agent
run timeline), Project Health, Decisions, Security Signals, Duplicate
Intelligence, Weekly Brief, Command Palette (⌘G, grounded Q&A over real
investigations). Project Memory and Agent Activity are partially honest
placeholders (see §5 — no dedicated backend endpoint for raw
retrieval-browsing or persistent activity log yet; they derive from
investigation history instead).

**Credentials:** real `GITHUB_TOKEN` and `GROQ_API_KEY` are in `.env`
(gitignored, confirmed not tracked). `GROQ_MODEL=openai/gpt-oss-120b`.

---

## 3. Files actively edited this session

Everything below is **uncommitted** on top of `a983e9b` (the last commit,
titled "Phase 0 stabilization, frozen API contract, memory layer, and
dashboard rebuild"). Run `git status` / `git diff` to see the exact diff.

**Backend — bug fixes to already-built code:**
- `agents/triage/security_scanner.py` — keyword list expanded + fixed
  (word-boundary regex, underscore/hyphen normalization) — see §4 for the
  two real bugs this fixed
- `api/routes_investigations.py` — fixed a background-task deadlock; added
  `repo_name` query filter to `/api/investigations` and `/api/escalations`
- `api/routes_repos.py` — fixed a path-param naming bug that silently
  broke `repo_name` construction in `/health` and `/brief` endpoints
  (`memory.repo` module now aliased `db` to avoid shadowing the `repo`
  path param); split file-indexing and issue-indexing into independent
  background tasks
- `api/main.py` — added `repo.reconcile_orphaned_investigations()` at
  startup
- `memory/repo.py` — `insert_step` changed from INSERT to UPSERT (fixed a
  UNIQUE-constraint crash); added `reconcile_orphaned_investigations()`
  and `update_investigation_title()`
- `mcp_server/client.py` — added a same-loop deadlock guard in
  `call_tool_sync`
- `mcp_server/github_client.py` — disabled PyGithub's default 10-retry
  backoff (`GithubRetry(total=0)`) so rate-limit hits fail in ~0.3s instead
  of hanging for minutes
- `rag/embedder.py`, `rag/retriever.py` — added `hnsw:space: cosine` to
  both Chroma collections so relevance scores are properly bounded 0-1
  (previously mis-scaled/negative under default L2 space)
- `requirements.txt` — pinned `mcp>=1.28,<2.0` (mcp 2.0.0 has a different
  API surface, broke `FastMCP` imports)

**Dashboard — full rewrite, most files new:**
- `dashboard/src/lib/RepoContext.tsx` (new) — repo picker state,
  localStorage-persisted
- `dashboard/src/lib/adapters.ts` (new) — maps real API shapes onto the
  UI's `Investigation`/`AgentStep`/`EvidenceRef` types; `
  loadInvestigationsWithDetail()` is the main helper every page now uses
- `dashboard/src/lib/api.ts`, `types.ts`, `useSocket.ts` — rewritten for
  the real backend contract (`api/schemas.py` mirror) + repo-scoped query
  params
- `dashboard/src/components/Sidebar.tsx` (new) — repo picker with a URL
  normalizer (accepts `owner/repo`, `https://github.com/owner/repo`,
  `.git` suffix, `git@github.com:...` — all forms)
- `dashboard/src/components/{AttentionCard,DecisionBadge,ConfidenceRing,
  EvidenceChip,EvidenceGraph,AgentRunTimeline,ActivityStream,MetricCard,
  InsightCard,HealthChart,CommandPalette,Layout,TopBar,ActionApproval}.tsx`
  (new) — the full component set for the current design
- `dashboard/src/pages/*.tsx` (new dir) — one file per screen
  (CommandCenter, AttentionQueue, IssueDetail, ProjectHealth, Decisions,
  WeeklyBrief, DuplicateIntelligence, SecuritySignals, ProjectMemory,
  AgentActivity)
- Old neo-brutalist-era components/pages were **deleted**
  (`AgentActivityFeed`, `AgentStatusIndicator`, `AppShell`,
  `ConfidenceIndicator`, `EscalationTable`, `EvidenceCard`,
  `HealthScoreCard`, `HealthTrendChart`, `InvestigationList`,
  `InvestigationStep`, `InvestigationTrace`, `SeverityBadge`,
  `EmptyState`, `ErrorState`, `SkeletonState`, `lib/mocks.ts`,
  `lib/format.ts`) — superseded by the current page-based structure
- `dashboard/src/lib/seed.ts` (new, untracked) — still exists as the
  **type source** for `Investigation`/`Decision`/`AgentStep`/`EvidenceRef`
  shapes (adapters.ts converts real API responses into these shapes so
  components didn't need rewriting) — it is NOT used for data anymore,
  only for its TypeScript type definitions

**Not part of this codebase, sitting in the working tree, untouched:**
`DESIGN (1).md` (untracked, not mine, left alone), `dashboard/public/`
(pre-existing favicon/icon assets, not from this session's scaffold).

---

## 4. Everything tried that failed (and the real root causes found)

These are worth reading before touching the affected files again — each
looked like a different kind of bug before the real cause was found.

1. **"expressjs/express investigation hangs forever at step 1."**
   First hypothesis: cross-event-loop deadlock in `call_tool_sync`
   (`asyncio.run()` in a background thread scheduling back onto the main
   loop via `run_coroutine_threadsafe`, then blocking on `future.result()`
   from *inside* that same main loop — a genuine self-deadlock, reproduced
   independently in isolation). Fixed the immediate cause
   (`background_tasks.add_task(_run_investigation, ...)` instead of
   wrapping in `asyncio.run` in a thread) — **but the hang persisted.**
   Second hypothesis, confirmed correct: **GitHub rate limit exhaustion**
   (`X-RateLimit-Remaining: 0`), compounded by PyGithub's default
   `GithubRetry(total=10)` silently backing off for 5-8 minutes per call
   instead of raising — indistinguishable from a hang without inspecting
   raw response headers. Both issues were real and both got fixed (the
   loop-safety guard in `call_tool_sync` is still a legitimate defensive
   fix even though it wasn't the actual cause this time).

2. **Security scanner missed a real CVE-referenced issue** (express
   #7391, "fails open... (CVE-2026-12590)", mentions DoS). Root cause:
   keyword list didn't include `cve`, `dos`, `denial of service`, or
   `fails open`. Fixed by expanding the list to match `agents/CLAUDE.md`
   §4.3's original spec plus these real-world additions.

3. **False-positive security finding**: `"rce"` matched inside
   "enfo**rce**ment" via bare substring search. Fixed with `\b` word-boundary
   regex matching — but this then caused a **regression**: `"auth"` no
   longer matched inside "authenticate" (correct per word-boundary logic,
   but lost a real signal), and `"api key"` didn't match `API_KEY`
   (underscore vs. space). Fixed by adding `authenticate`/`unauthorized`
   as explicit keywords and normalizing underscores/hyphens to spaces
   before matching.

4. **Health scores always flat at neutral 70**, even for repos with
   multiple escalated/duplicate investigations. Root cause: `
   get_repo_health`/`get_brief` route functions declared a parameter named
   `repo_slug` while the path template was `{owner}/{repo}` — FastAPI never
   bound the path segment, so `repo_name` silently became just `owner`
   with no matching investigations. Compounded by `from memory import repo`
   shadowing a function parameter also named `repo` once the naming was
   fixed. Fixed by renaming the param to match the path (`repo: str`) and
   aliasing the module import to `db`.

5. **Cross-repo data leak**: switching the dashboard's repo picker didn't
   change the escalation count or investigation list — both endpoints
   returned data for *every* repo, filtered only client-side inconsistently
   across pages. Fixed with a real `repo_name` query param on both
   endpoints, used consistently everywhere.

6. **`UNIQUE constraint failed: chain_steps.step_id`** crash on every
   investigation. Root cause: `chain_step` decorator legitimately writes
   the same `step_id` twice (once `running`, once `done`), but
   `insert_step` was a plain `INSERT`. Fixed with `INSERT ... ON CONFLICT
   DO UPDATE`.

7. **Repo picker accepted a pasted full GitHub URL as literal repo_name**
   (`https://github.com/aryabailur/Doombot.git`), which then matched
   nothing on the backend. Fixed with a normalizer accepting 4 common
   input forms, rejecting anything else with a visible inline error.

8. **Stuck-forever "running" investigations** from the deadlock-debugging
   era, never resolved because the server was killed mid-run. These are a
   **structural gap**, not a one-off — any server restart mid-investigation
   leaves an orphaned row. Fixed generally with a startup reconciliation
   pass (`reconcile_orphaned_investigations()`), not just a one-time manual
   cleanup.

9. **`mcp>=1.28` resolved to `mcp==2.0.0`**, which has a different API
   (`mcp.server.fastmcp.FastMCP` doesn't exist in that surface) — broke
   `mcp_server/tools.py` imports. Pinned to `mcp>=1.28,<2.0`, confirmed
   `1.29.0` has the expected API.

---

## 5. Next step

Nothing is currently broken or mid-fix — the session ended on a clean,
verified state. In priority order, here's what I'd do next:

1. **Commit and push this work.** Everything above is uncommitted on
   `feat/a-core-api-and-dashboard`. That branch was pushed once earlier
   (before this session's fixes) — needs a new commit + push. Given the
   scale of changes (bug fixes across backend + a full dashboard rewrite),
   consider whether this should be one commit or split by concern
   (backend fixes vs. dashboard rewrite) before opening/updating the PR.
   Recall from the earlier session: this branch was built from a **stale
   base** — `origin/main` has since advanced with real Stream B/C/D work
   this branch doesn't incorporate, so merging will need real
   reconciliation, especially in `dashboard/` (two different dashboards
   now exist: the one already merged on `main`, and this session's).

2. **Wire a real Project Memory / retrieval-browser endpoint.** Right now
   `ProjectMemory.tsx` derives stats from investigation history rather
   than exposing raw Chroma retrieval — there's no backend endpoint for
   "show me what's indexed" or "run an ad-hoc similarity query." Would
   need a new route (e.g. `GET /api/repos/{owner}/{repo}/memory`) backed
   by `rag.retriever`.

3. **Persistent Agent Activity log.** `AgentActivity.tsx` currently only
   shows events from the *current browser session's* WebSocket stream —
   refreshing the page loses history. Would need either a dedicated
   `activity_log` table or a derived view over `chain_steps` +
   `investigations` joined and paginated.

4. **Re-check `get_issues`'s scale characteristics.** During this session,
   fetching 100 issues from a large/busy repo (express) took over a
   minute in one run — likely from PyGithub's per-issue lazy attribute
   fetches (`.pull_request`, `.user.login`, `.labels`) each costing a
   separate API call, compounded by GitHub's Issues API mixing in PRs
   that then get filtered out client-side. Worth profiling and possibly
   requesting fewer fields per page or using GraphQL instead of REST for
   bulk issue listing if this becomes a real bottleneck.

5. **Decide on health-score staleness signal.** `_compute_health_breakdown`
   in `api/routes_repos.py` hardcodes `staleness = 70.0` with a "no
   repo-age signal wired yet" comment — this is an intentional, honest
   placeholder, not a bug, but it's the one sub-score that's never real.


---
---

# Handoff — session of 2026-08-20/21 (branch `mayank-dashboard`)

**Everything above this divider belongs to an earlier session on
`feat/a-core-api-and-dashboard`. It is preserved untouched. This section is a
separate piece of work on a different branch — read whichever matches the
branch you are on.**

**Branch:** `mayank-dashboard` @ `0ca68c9` — pushed, **not merged**
**Base:** `origin/mayank` @ `dd1258d` (untouched)
**`main`:** `3d53ce1` (untouched, deliberately — the user asked twice that this
work stay off `main`)

---

## 1. The goal

Take the RepoGuardian dashboard on the `mayank` branch and add the one thing it
was missing: **both graphs** — the issue-relationship graph and the semantic
code graph. Explicit constraints from the user:

- Only the dashboard/frontend from `mayank`; do not restructure the rest.
- Work on a separate branch for safety. **Do not touch `main`.**
- **Do not touch the VS Code extension or the Chrome extension.** (Stated
  twice. Verified file-by-file at each commit; neither was modified.)

## 2. What the goal turned out to require

The ask was "only the frontend", but this branch had **no `rag/graph.py` and no
graph endpoints at all**, so a frontend-only change would have had nothing to
render. The backend port was unavoidable, and is deliberately minimal and
additive:

| File | Change |
|---|---|
| `rag/graph.py` | **new** — ported verbatim from `main` (both builders) |
| `api/schemas.py` | appended the F15 models verbatim; later fixed `Evidence.score` |
| `api/routes_repos.py` | appended `GET .../graph` and `.../code-graph` |
| `rag/embedder.py` | added `get_collection()` — purely additive |
| `dashboard/src/pages/Graphs.tsx` | **new** — the page |
| `dashboard/src/App.tsx` | one route |
| `dashboard/src/components/Sidebar.tsx` | one nav item |
| `dashboard/src/lib/types.ts` | graph types (hand-mirrored from schemas) |
| `dashboard/src/lib/api.ts` | two fetchers |
| `dashboard/package.json` | `react-force-graph-2d` (new dependency — rule 10) |

Two compatibility details that matter if this is ever re-ported:

- This branch indexes Chroma with `hnsw:space: cosine`; `main` uses L2. Porting
  `graph.py` is safe **only because** it computes cosine from the raw
  embeddings itself rather than reading distances.
- `get_collection` duplicates this branch's Chroma config on purpose, with a
  comment saying so. If `persist_directory`, the collection-name suffix, or the
  space drift from `index_issues`, it silently opens a *different, empty*
  collection and every graph returns zero nodes.

## 3. Current state

Working, verified against live data:

- **Issue graph** — yt-dlp 150 nodes / 655 links.
- **Code graph** — Doombot 254/283, express 118/106, yt-dlp 1018/1425.
- **All 12 existing pages** still serve 200; every endpoint the dashboard calls
  returns 200 with sane payloads.
- **Investigation detail page** — was completely broken, now fixed (see §5).
- `tsc` clean, `npm run build` succeeds, force-graph lazy-split into its own
  ~172 kB chunk so the other eleven routes do not pay for it.

Six commits, each verified before the next:

```
9d6b471  feat: add both graphs to the RepoGuardian dashboard
073c6f9  fix: load the code graph on demand and size its filter to the repo
eb9bc97  fix(api): allow a null evidence score
2e3d153  fix: make the code graph interactive instead of a static picture
f0b2e09  fix: stop a slow code-graph fetch stranding the next repository
0ca68c9  fix: restore the missing graph filters, drop the hover tooltip
```

## 4. Files actively being edited

`dashboard/src/pages/Graphs.tsx` is the live one — five of six commits touch it.
It is ~700 lines and holds both graph views in one component, split by a `view`
state (`"issues" | "code"`). It wants splitting (see §6); it has not yet been.

The backend files are settled and unlikely to need more work.

**Untracked, do not commit:** `chroma_g/` and `vscode-extension/out/` sit in the
working tree, are **not** gitignored on this branch, and were never staged.
`git add -A` here would commit build output into the repo. Stage explicitly.

## 5. What failed, and what each failure taught

Recorded because several were my own mistakes, and the reasons matter more than
the fixes.

**The investigation page was broken before I arrived, and it was a schema bug,
not a UI bug.** Every detail page showed "Could not load this investigation."
`GET /api/investigations/{id}` returned 500: `Evidence.score` was declared a
required `float`, but this repo's own contract (`agents/CLAUDE.md` §3.6) is
`float | None`, and rule-type evidence legitimately has no score. The schema
rejected the output of the very nodes it exists to describe. **38 of 38 detail
pages now return 200; previously 0.** Lesson: when the frontend says "could not
load", check the endpoint before the component.

**I pinned the code-graph layout and made it a dead picture.** I set `fx`/`fy`
from server positions with `cooldownTicks={0}`, reasoning that a stable layout
was a virtue. It was — but nothing settled and nothing could be dragged, so it
read as a diagram rather than a graph. Server positions now *seed* rather than
pin: fast convergence and real interaction.

**I drew every node label unconditionally.** 129 symbol names overlapped into
mush and hid the structure they were meant to explain. Labels are now
progressive — focused neighbourhood, selected node, or past 1.5x zoom — each on
a card-coloured plate so a label crossing an edge stays legible.

**I fetched both graphs eagerly on mount.** The code graph reads every source
file over the network (43s on yt-dlp), so merely opening the page paid that cost
even for someone who never left the Issues tab. Now fetched when its tab is
first opened.

**My lazy-fetch guard then stranded the next repository.** `loadingCode` was
never reset on repo change, so a request still in flight for the previous repo
left it `true`, and `if (loadingCode) return` blocked the new fetch
**permanently** — the panel sat on "Reading source..." for a request that would
never be made, while the API answered that same call in 0.2s. Both this and
stale-response bleed are now keyed on `owner/repo`. Lesson: a guard flag not
reset on the dimension it guards is a deadlock waiting to happen.

**A fixed `minDegree` default did not scale.** 2 is right for a 250-symbol
project; on yt-dlp it still left 471 nodes and 1064 edges. The initial floor is
now chosen from the payload (raised until under ~320 nodes): yt-dlp opens at 3,
express and Doombot at 2.

**The filter set was thinner than the reference and I had not noticed** until
the user pointed it out. `main`'s graph has Subsystem / Runtime / Min
connections / Show all; this page had only two of those. Runtime now renders
only when the dimension varies — every symbol in express is `shared`, so a
one-option control there is noise. "Show all" matters more than it looks: the
initial floor is auto-chosen, so without an explicit reset to 0 the unfiltered
graph was unreachable from the UI.

**The hover tooltip actively defeated the hover.** `nodeLabel` produces a
floating black box tracking the cursor directly over the neighbourhood the
hover exists to reveal. Removed from both graphs; the information moved to the
click panel (code) and the caption line (issues).

**Two tooling notes that cost real time.** Heredoc-quoted Python mangles `\n`
inside string literals — it became a real newline three separate times and broke
the file each time; use the Edit tool or line-index replacement for anything
containing escapes. And Git Bash rewrites a leading `/graphs` into
`C:/Program Files/Git/graphs` in curl URLs; prefix with `MSYS_NO_PATHCONV=1`.

## 6. The next step I would take

**Split the two views out of `Graphs.tsx`.** At ~700 lines with two canvases,
two filter sets, two painters and two focus models in one component, the next
change to either half risks the other. `IssueRelationshipGraph` and
`CodeStructureGraph` as siblings under a thin `Graphs` shell.

Then, in rough order of value:

1. **Decide whether this branch merges to `main` at all.** It duplicates
   `rag/graph.py` and the graph schemas that already exist on `main`, on a
   diverged history. Someone has to choose which dashboard ships — this one or
   `main`'s — because maintaining both is the real cost here, not the graphs.
2. **The `RepoGuardian` / `Doombot` naming split** is now visible on `main` too
   (the Chrome extension is `repoguardian-lens`). A judge will notice two
   product names. Worth settling before the demo.
3. **`psf/black` takes ~44s cold** on the code graph — 60 files, one request
   each. Bounded and cached, but a demo that opens the Code tab on an unvisited
   large repo will wait. Pre-warm whatever you plan to show.
4. **This branch has no pytest suite** — `tests/` holds only `manual_*.py`
   scripts, so none of the verification above is a test run. If this branch
   survives, porting `tests/test_api_contract.py` from `main` would have caught
   the `Evidence.score` bug immediately.

## 7. Environment notes

- API and dashboard were left **running**: `uvicorn api.main:app --port 8000`
  (with `DEMO_MODE=1`, so no GitHub writes) and `npm run dev` on 5173.
- **Keep `DEMO_MODE=1`.** Issue comments on public repos do not require push
  access, so a `comment` or `close_duplicate` decision can genuinely post to a
  real open-source project.
- GitHub's quota was exhausted once this session (5000/hour, **per account, not
  per token** — a new PAT on the same account does not help). The code-graph fix
  removed the main drain; onboarding a large repo is still the expensive
  operation.
- `main` picked up substantial work this session that is *not* on this branch:
  F17 adaptive repository learning, F18 the MCP intelligence layer, the
  code-graph performance fix, and tanay's Chrome extension. If this branch is
  ever rebased, expect those to be the interesting conflicts.

---
*Appended 2026-08-21. Everything above the second `---` divider is a different
session on a different branch and was not modified.*
