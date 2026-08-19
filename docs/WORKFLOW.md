# Workflow — Git, PRs, and Integration

Four people, one repo, ~30 hours. The workflow exists for one reason: **so nobody
is ever blocked, and `main` is always demoable.**

Repo: `https://github.com/aryabailur/Doombot.git`

---

## 1. Golden rules

1. **`main` is always demoable.** If `main` breaks, fixing it preempts everything.
2. **Never commit directly to `main`.** One feature, one branch, one PR.
3. **Rebase, don't merge.** Conflicts get resolved on your branch, before the PR.
4. **Own your files.** Never edit another stream's files (see §3).
5. **Small PRs.** Under ~400 lines. Big PRs don't get reviewed at 3am.
6. **Never `--force` push a shared branch.** Your own feature branch, fine.

---

## 2. Branch model

```
main ───────●────────●─────────●──────────●─────────>  always demoable
             \      /  \      /  \       /
              ●────●    ●────●    ●─────●              short-lived feature branches
           feat/a-…  feat/b-…  feat/c-…
```

No `develop` branch, no release branches, no long-lived forks. At this timescale
they cost more than they return.

### Naming

```
feat/<stream>-<slug>      feat/a-sqlite-layer
fix/<stream>-<slug>       fix/b-mcp-tool-names
docs/<slug>               docs/agent-manuals
chore/<slug>              chore/requirements
```

`<stream>` is `a`, `b`, `c`, or `d`. The prefix makes `git branch -a` instantly
readable and tells reviewers who owns what.

**One branch per logical change.** Not one branch per person per day.

---

## 3. Ownership map

Exclusive. If a file isn't yours, you don't edit it.

| Stream | Person | Owns |
|---|---|---|
| **A — Core & API** | A | `api/`, `memory/`, `mcp_server/client.py`, `mcp_server/tool_names.py`, `scripts/` |
| **B — Agents & RAG** | B | `agents/`, `rag/`, `mcp_server/github_client.py`, `mcp_server/tools.py` |
| **C — Frontend Core** | C | `dashboard/src/lib/`, `components/Investigation*`, `Evidence*`, `SimilarIssue*`, `Confidence*`, `Approval*` |
| **D — Shell & Ext** | D | `dashboard/src/App.tsx`, `components/AppShell*`, `Repo*`, `Agent*`, `Health*`, `Escalation*`, `Severity*`, `Empty*`, `Error*`, `Skeleton*`, `vscode-extension/` |

### Shared files — announce before touching

| File | Why it's shared | Protocol |
|---|---|---|
| `api/schemas.py` | Backend↔frontend contract | §5 |
| `dashboard/src/lib/types.ts` | Hand-mirror of the above | Same PR as `schemas.py` |
| `agents/state.py` | Both graphs read it | Tell Stream B lead |
| `mcp_server/tool_names.py` | A registers, B consumes | Add only, never rename |
| `requirements.txt`, `package.json` | Everyone installs it | Announce; it costs install time |

**Found a bug in someone else's file?** Tell them. Do not fix it silently — a
cross-stream edit is how a merge queue deadlocks at 4am.

---

## 4. The cycle

```bash
# 1. Always start from fresh main
git checkout main
git pull origin main

# 2. Branch
git checkout -b feat/a-sqlite-layer

# 3. Work — small, focused commits
git add memory/db.py                       # specific paths; never `git add -A`
git commit -m "feat(memory): add SQLite schema and connection helper"

# 4. Rebase before pushing — resolve conflicts HERE
git fetch origin
git rebase origin/main
#    conflict? fix it, then:  git add <file> && git rebase --continue

# 5. Push and open the PR
git push -u origin feat/a-sqlite-layer
gh pr create --base main --title "feat(memory): SQLite persistence layer" --body "..."

# 6. After merge, clean up
git checkout main && git pull origin main
git branch -d feat/a-sqlite-layer
```

### Commits

Conventional Commits — `type(scope): summary`:

```
feat(api): add investigation routes with fixture responses
fix(mcp): correct post_review_comment tool name mismatch
docs(agents): document chain_step contract
chore(deps): pin langgraph to 1.2.9
```

Types: `feat` `fix` `docs` `chore` `refactor` `test`
Scopes: `api` `memory` `mcp` `agents` `rag` `dashboard` `ext` `deps`

Breaking change: add `!` — `feat(api)!: rename StepRecord.title to label`

---

## 5. The contract freeze

`api/schemas.py` is the interface between backend and frontend. It ships **first**,
with every endpoint returning **hardcoded fixtures** matching the models.

That single decision is what keeps four people unblocked: frontend gets real HTTP
responses in hour one and never waits on backend logic.

```
H0 ──── H2 ──────────────────────────────────────────>
        │
        └─ schemas.py + fixture endpoints merged to main
              │
              ├─ Stream A replaces fixtures with real logic
              ├─ Stream B builds graphs, unaware of the API
              ├─ Stream C builds against real HTTP from hour one
              └─ Stream D builds against real HTTP from hour one
```

### Changing the contract after the freeze

1. **Announce it** — before writing code
2. Change `api/schemas.py` **and** `dashboard/src/lib/types.ts` in the **same PR**
3. Title the PR `feat(api)!: …` — the `!` marks it breaking
4. Request review from **both** frontend owners

There is no codegen. Keeping the two files in sync is a human responsibility,
enforced by rule 2.

---

## 6. Dependency order

Some work genuinely sequences. Everything else runs parallel.

```
Phase 0  stabilization (A)          ← blocks everything, nobody branches until merged
   │
   ├── contract freeze (A)          ← unblocks C and D
   │        │
   │        ├── C: lib + investigation surfaces
   │        └── D: shell + overview + escalations
   │
   ├── memory layer (A) ──────► graph runner (A)
   │                                  ▲
   └── B: chain.py ──► triage nodes ──┘
            │
            └── rag: issue indexing ──► duplicate detection
```

**Rule for sequenced work:** if B needs A's merged work, B **waits for the merge
and rebases**. B does not copy A's code onto B's branch. Two copies of the same
function is a guaranteed conflict.

Blocked and can't proceed? Say so immediately in the team channel. Silent blocking
is the most expensive failure mode in a hackathon.

---

## 7. PR template

```markdown
## What
One or two sentences.

## Stream
A / B / C / D

## Feature
F0X — <name from docs/DESIGN.md §3>

## Contract
Which section of which CLAUDE.md this satisfies.

## Verification
Exact commands run, and their real output.

## Contract changes
None. (Or: describe the breaking change and who was told.)

## Screenshots
Frontend PRs only.
```

### Review

- **One approval** before merge. At 3am, one is the realistic bar.
- Reviewer checks: contract satisfied · no out-of-scope files · verification output
  present and real · no secrets · no `TODO` on a demo path.
- **Squash merge**, then delete the branch.
- Reviewing beats building when someone is blocked on your review.

---

## 8. Integration checkpoints

Four moments where everyone stops and integrates. Non-negotiable — the failure
mode they prevent is four streams that each work alone and don't compose.

| Gate | When | Passes when |
|---|---|---|
| **G1 — Core runs** | H2 | `python app.py` posts a real PR comment |
| **G2 — Contract live** | H3 | Every endpoint returns fixture JSON; C and D are consuming it |
| **G3 — Stream visible** | H10 | `wscat -c ws://localhost:8000/ws` shows ordered `step.started`/`step.completed`, and the UI renders them |
| **G4 — Replay proof** | H16 | Kill the API mid-investigation, restart, `GET /api/investigations/{id}` replays the full chain from SQLite |

At each gate: everyone merges to `main`, pulls, and runs the whole stack together.
Anything broken gets fixed before new work starts.

---

## 9. When things go wrong

**`main` is broken** — highest priority, whoever notices. Revert the merge
(`git revert -m 1 <sha>`) rather than debugging forward under pressure.

**Rebase conflict you don't understand** — stop. Don't `--force`. Ask the owner of
the conflicting file.

**Two people edited the same file** — an ownership breach. The owner's version
wins; the other reapplies on top.

**You're 30 minutes past your estimate** — say so. Re-scope or hand off. The cut
list in `docs/PLAN.md` exists precisely for this.

**Groq rate-limits or wifi dies** — `DEMO_MODE=1` plus `python -m scripts.seed_demo`.
See `scripts/CLAUDE.md`.

---

## 10. Freeze

At **H30**, `main` freezes. After that: demo-blocking bug fixes only, each needing
a second person's sign-off.

Then rehearse the demo three times, on the actual demo machine, on venue wifi.
