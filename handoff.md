# Handoff — RepoGuardian / Doombot

**Branch:** `mayank` (pushed to `origin/mayank`; based on `feat/a-core-api-and-dashboard`, itself unmerged to `main` — see git status below)
**Session date:** 2026-08-21 (this update) — supersedes the 2026-08-20 handoff, which is preserved below as §6-§10 for historical/root-cause context.

---

## 1. The goal

Make **Doombot** (backend agent name) / **RepoGuardian** (dashboard product name) —
a GitHub issue-triage agent — actually work end-to-end against **any real
external repository**, with every stage of analysis (fetch → duplicate
detection → security scan → impact score → labeling → decision) visibly
shown and correct on a live dashboard, gated by human approval before any
GitHub write above/below the auto-apply confidence threshold. Real GitHub
reads/writes, real RAG-based duplicate detection, real Groq-driven decisions,
all driven from a repo picker — not fixture data.

This session's focus, on top of the prior session's real-pipeline work: (a)
audit the built product against the actual PS-04 hackathon spec and fix the
highest-risk gaps, (b) push the result to a new branch, (c) add a second
round of UI polish/animation, (d) verify live against a large, previously
untouched external repo (`microsoft/vscode`) to answer "does this work for
*any* repo, not just the ones already tested."

---

## 2. Current state — what works right now (verified this session)

Both servers were running for live verification:
- API: `uvicorn api.main:app --port 8000`
- Dashboard: `npm run dev` in `dashboard/` (port 5173)

**Verified live, end-to-end, against `microsoft/vscode` — a large, popular,
entirely fresh repo never touched in any prior session or test:**
- Full 6-step investigation pipeline (fetch → duplicate → security →
  impact → label → decide) completed successfully on a real open issue,
  all steps `status: done`, real `tool_calls` populated, dashboard rendered
  it correctly (timeline, evidence graph, decision badge, zero console
  errors) — confirmed via live Playwright screenshot.
- `GET /api/repos/microsoft/vscode/health` returns real computed data
  (score 92.5), not a fixture.
- Indexing (`POST /api/repos/microsoft/vscode/index`) completed
  successfully — took 1-2+ minutes (known characteristic, see §2.1) but
  produced a real Chroma collection with `doc count: 100`.
- Project Memory search (`GET /api/repos/microsoft/vscode/memory?q=terminal`)
  returned real ranked semantic results after indexing completed.

**Conclusion: the pipeline is not special-cased to any particular repo** —
it works generically against any `owner/repo` the user points it at,
including ones several orders of magnitude larger/busier than anything
tested in the prior session (`octocat/Hello-World`, `aryabailur/Doombot`,
`expressjs/express`).

### 2.1 One real bug found and fixed during this verification

**Negative relevance scores** in Project Memory search results (e.g.
`-13%`, `-14.3%`, `-15.5%` shown as "relevance") on repos where a query has
generally low similarity to the whole indexed corpus. Traced directly with
`rag.retriever.retrieve_with_scores()` — confirmed the raw negative values
come straight from LangChain/Chroma's own
`similarity_search_with_relevance_scores()`, not from any Doombot code (a
known upstream quirk: scores aren't strictly bounded to [0,1] in that
scenario). **Fixed** in `api/routes_repos.py`'s `query_memory()` only, by
clamping for display:
```python
score = max(0.0, min(1.0, raw_score))
```
Deliberately **not** touched in `rag/retriever.py`'s shared scoring
function — other consumers (`find_duplicates`) rely on its raw threshold
behavior and clamping there could silently change duplicate-detection
sensitivity. Verified fixed live: restarted API server, re-queried,
scores came back `0.176, 0.0, 0.0, 0.0, 0.0` — no negatives.

### 2.2 One known, non-bug limitation (worth remembering, not fixing blind)

Indexing a very large repo (vscode-scale) takes 1-2+ minutes. Root cause
(already documented in §9 below from the prior session): PyGithub does a
separate API call per issue for lazily-fetched attributes, multiplied by up
to 100 issues per `index_issues()` call. Confirmed again this session by
running `index_issues()` directly in Python — it exceeded a 60s foreground
timeout and had to move to background, then completed successfully. Not a
regression, not a hang — just slow at this repo size. If this becomes a
demo-day risk (judges waiting on a spinner), the fix would be GraphQL bulk
fetch instead of REST-per-issue, not attempted this session.

---

## 3. Files actively edited this session (all uncommitted as of writing, on `mayank`)

```
 M api/routes_repos.py                        (+8/-1)   — score clamping in query_memory()
 M dashboard/src/components/ActivityStream.tsx (+19/-6)  — stagger-in + live pulse polish
 M dashboard/src/components/DecisionBadge.tsx  (+18/-8)  — badge alert/check/bob/spin-in animations
 M dashboard/src/components/EvidenceChip.tsx   (+10/-4)  — chip entrance polish
 M dashboard/src/components/HealthChart.tsx    (+38/-6)  — path-draw/area-fade/point animations, per-repo replay
 M dashboard/src/components/Sidebar.tsx        (+18/-8)  — nav indicator slide, hover translate, index-button check-pop
 M dashboard/src/index.css                     (+100)    — new keyframes: badge-alert/check/bob/spin-in, path-draw,
                                                             area-fade, chart-point, skeleton-block/pulse,
                                                             nav-indicator, check-pop, tilt-on-hover, text-shimmer
 M dashboard/src/pages/IssueDetail.tsx         (+12/-3)  — skeleton-block loading state (replacing plain text)
 M dashboard/src/pages/WeeklyBrief.tsx         (+35/-9)  — animated brief reveal, shimmer title, staggered lines
```

All animation additions respect the pre-existing global
`@media (prefers-reduced-motion: reduce)` rule in `index.css` — nothing new
bypasses it.

**Not edited this session, but load-bearing from the prior session** (see
§7-§10 below): `agents/triage/labeler.py` (approval-required security
labels), `api/routes_investigations.py` (dedup + suggested-actions),
`memory/db.py` / `memory/repo.py` (suggested_actions table,
tool_calls_json), `dashboard/src/lib/adapters.ts` (status-mapping fix),
various page-level decision-badge double-mapping fixes.

---

## 4. Everything tried that failed this session

1. **SVG nesting attempt for `ConfidenceRing`** — tried nesting
   `<AnimatedNumber>` (renders a `<span>`) inside an SVG `<text>` element.
   SVG text requires `<tspan>`/text nodes, not arbitrary HTML — caught
   before shipping, self-corrected by rewriting `ConfidenceRing.tsx` to do
   the percentage count-up inline via `requestAnimationFrame` alongside the
   arc sweep, instead of reusing the `<AnimatedNumber>` component.
2. **CSS mask Firefox incompatibility** — `.animate-live-border::after`
   initially used only `-webkit-mask`/`-webkit-mask-composite`. Fixed by
   adding the standard (unprefixed) `mask`/`mask-composite` properties
   alongside.
3. **Template-literal bug in a `MetricCard`-style className** — wrote a
   `${...}` interpolation inside a plain (non-backtick) string by mistake.
   Caught immediately, fixed by wrapping in backticks properly.
4. **Server serving with a stale GitHub token** — after the user pasted a
   new token into `.env` (twice, in chat — see §5, security note), the
   already-running `uvicorn` process kept using the old token because env
   vars are only read at process start. Diagnosed by checking token
   validity independently (new token had full 5000/5000 quota) and tailing
   `/tmp/api_server.log`, confirming server-side staleness. Fixed with
   `lsof -ti:8000 | xargs kill -9` + relaunch.
5. **Push rejected on `mayank` branch — 100MB file limit** —
   `chroma_db/chroma.sqlite3` had grown to 103MB across commit history
   during testing. `git rm --cached` alone was insufficient (blob still in
   earlier commits' trees). User chose full history rewrite over other
   options; used `git filter-branch --index-filter` to strip the blob from
   every commit on the (brand-new, unpushed at the time) `mayank` branch,
   cleaned up `.git/refs/original/`, expired reflog, ran
   `git gc --prune=now --aggressive`. Verified the local on-disk file was
   untouched and no >50MB blobs remained in history before the push
   succeeded.

---

## 5. Security note (must persist across sessions)

The user pasted a **real GitHub personal access token into chat, twice**,
in this session's earlier portion:
`github_pat_[REDACTED — revoked; original recorded only in local session notes]`

I flagged both times that any token typed into chat should be treated as
compromised and told the user to revoke it at
`github.com/settings/personal-access-tokens` (or `/tokens` for classic
tokens), and to paste future tokens directly into `.env` only, never into
chat. **I did not independently confirm the token was actually revoked** —
this should be re-checked with the user if credential issues come up again.
Also: an even older stale token was mentioned once as possibly still
sitting in `.env` from before either pasted token — never explicitly
confirmed cleaned up.

---

## 6. Next step (priority order)

1. **Confirm the pasted token(s) were actually revoked.** Not verified by
   me — ask the user directly, or check the token's status via the GitHub
   API if a current token is available (`GET /rate_limit` with the old
   token should now 401).
2. **Decide on the `mayank` branch → PR.** It's pushed to
   `origin/mayank` but no PR has been opened (I asked "open it now, or
   leave it for review first?" earlier and the user never answered — do
   not open one unassisted). Given `feat/a-core-api-and-dashboard` (its
   base) is itself unmerged and stale relative to `origin/main`, merging
   will need real reconciliation — see §10 item 1 below, still unresolved.
3. **Run `npx tsc --noEmit` and a fresh Playwright pass** on the current
   uncommitted animation changes before committing — they were
   individually verified live during the session but not re-verified as a
   combined diff.
4. **If demo-day timing is a concern**, address the vscode-scale indexing
   slowness (§2.2) — likely a GraphQL bulk-fetch rewrite of
   `rag/embedder.py`'s issue indexing, not attempted this session.
5. Everything in §10 (Next step, prior session) that's still unresolved:
   real Project Memory retrieval endpoint (**done this session** — see
   `GET /api/repos/{owner}/{repo}/memory`, §2 above), persistent Agent
   Activity log (**done** — see `GET /api/activity`), health-score
   staleness sub-score (**still a hardcoded 70.0 placeholder**, honest but
   unimplemented).

---

---

# Prior session (2026-08-20) — preserved for context

Everything from §7 onward is the handoff as written at the end of the prior
session, before the branch was renamed/pushed to `mayank` and before this
session's animation/verification work. Kept verbatim because the root-cause
narratives (§9) are still the best record of *why* several non-obvious
fixes exist — don't re-break these while touching the same files.

## 7. The goal (as originally stated)

Make Doombot/RepoGuardian actually work end-to-end against any real
external repository, with every analysis stage visibly shown and correct
on a live dashboard. Not a demo with seeded/fixture data — real GitHub
reads and writes, real RAG-based duplicate detection, real decisions, all
driven from a repo picker the user can point at anything.

Two earlier phases got there:
1. Backend contract build (FastAPI + SQLite + LangGraph triage pipeline),
   verified against mocked GitHub calls.
2. A full dashboard rebuild (neo-brutalist, then re-skinned to a "Calm
   Control Room" design spec) — originally on `seed.ts` fixture data, then
   rewired to call the real API.

## 8. State at end of prior session

**Verified working, live, with real credentials, against real external
repos:** `octocat/Hello-World` (read-only, no write access, expected),
`aryabailur/Doombot` (real writes: labels applied, duplicate comment
posted), `expressjs/express` (real CVE-referenced issue #7391 correctly
escalated at 85% confidence, no false positives).

**Dashboard pages confirmed showing real data:** Command Center, Attention
Queue, Issue Detail, Project Health, Decisions, Security Signals,
Duplicate Intelligence, Weekly Brief, Command Palette. Project Memory and
Agent Activity were, at that time, honest placeholders deriving from
investigation history rather than dedicated endpoints — **both have since
been given real endpoints** (`/api/repos/{owner}/{repo}/memory`,
`/api/activity`), confirmed working in §2 above.

## 9. Root causes found and fixed (prior session — still valid, don't re-break)

1. **Cross-event-loop deadlock + GitHub rate-limit exhaustion**, both real,
   both fixed independently — the deadlock guard in `call_tool_sync` is a
   legitimate defensive fix even though rate-limit exhaustion (compounded
   by PyGithub's default 10-retry backoff hanging 5-8 min per call) was the
   actual cause of the hang that surfaced it.
2. **Security scanner missed CVE-referenced issue** — keyword list lacked
   `cve`, `dos`, `denial of service`, `fails open`. Fixed by expansion.
3. **False positive**: `"rce"` substring-matched inside "enfo**rce**ment".
   Fixed with `\b` word-boundary regex — caused a regression (`"auth"` no
   longer matched "authenticate", `"api key"` didn't match `API_KEY`),
   fixed by adding explicit keywords and normalizing underscores/hyphens to
   spaces before matching.
4. **Health scores flat at neutral 70** — route param named `repo_slug`
   didn't bind to the `{owner}/{repo}` path template, so `repo_name`
   silently became just `owner`. Fixed by renaming the param and aliasing
   `from memory import repo` to `db` to avoid shadowing.
5. **Cross-repo data leak** — escalation/investigation endpoints returned
   data for every repo regardless of picker selection. Fixed with a real
   `repo_name` query param used consistently.
6. **`UNIQUE constraint failed: chain_steps.step_id`** — `chain_step`
   legitimately writes the same `step_id` twice (running, then done);
   `insert_step` was a plain INSERT. Fixed with `INSERT ... ON CONFLICT DO
   UPDATE`.
7. **Repo picker accepted a raw GitHub URL** as a literal repo_name,
   matching nothing server-side. Fixed with a normalizer accepting 4 input
   forms, rejecting anything else with a visible inline error.
8. **Orphaned "running" investigations** after a server restart mid-run —
   structural gap, not one-off. Fixed with a startup reconciliation pass
   (`reconcile_orphaned_investigations()`).
9. **`mcp>=1.28` resolved to `mcp==2.0.0`**, breaking `FastMCP` imports.
   Pinned to `mcp>=1.28,<2.0`.

## 10. Next step (as originally written — see §6 above for current priority)

1. Commit and push (done this session — branch renamed/pushed as `mayank`,
   but still not merged/PR'd, see §6.2).
2. Wire a real Project Memory retrieval endpoint (**done this session**).
3. Persistent Agent Activity log (**done this session**).
4. Re-check `get_issues` scale characteristics on large repos (**confirmed
   still slow this session, root cause unchanged, not yet optimized** —
   see §2.2, §6.4).
5. Health-score staleness signal — still a hardcoded `70.0` placeholder in
   `_compute_health_breakdown`, honest but unimplemented.
