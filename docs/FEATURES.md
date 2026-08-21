# Features — Owners, Branches, and Priority

The authoritative feature registry is `docs/DESIGN.md` §3. This file maps each
feature to **who builds it, on which branch, and in what order** — it does not
redefine scope.

**Feature IDs (F01–F20) are the shared vocabulary.** Every branch, PR, and task
references one. F15–F16 are specified in `STRETCH_FEATURES.md`, F17–F18 in
`docs/INTELLIGENCE.md`, F19–F20 in `AUTO_FIX.md`.

---

## 1. Registry

| ID | Feature | Priority | Stream | Branch prefix |
|---|---|---|---|---|
| F01 | GitHub integration & agentic monitoring | **P0** | A + B | `feat/a-`, `feat/b-` |
| F02 | Multi-step investigation trace | **P0** | B + C | `feat/b-chain`, `feat/c-trace` |
| F03 | Project-aware RAG | **P0** | B | `feat/b-rag-` |
| F04 | Selective escalation | **P0** | B + D | `feat/b-decider`, `feat/d-escalation` |
| F05 | Explainability & maintainer feedback | **P0** | A + C | `feat/a-feedback`, `feat/c-evidence` |
| F06 | Semantic duplicate & regression detection | **P0** | B + C | `feat/b-duplicate`, `feat/c-compare` |
| F07 | Security-sensitive issue detection | P1 | B | `feat/b-security` |
| F08 | Approval-controlled auto-labeling | P1 | B + D | `feat/b-labeler` |
| F09 | Incomplete-issue follow-up | P1 | B | `feat/b-completeness` |
| F10 | Project-health analysis | P1 | A + D | `feat/a-health`, `feat/d-health` |
| F11 | Maintainer weekly brief | P2 | A + D | `feat/a-brief` |
| F12 | MCP protocol server | P2 | B | `feat/b-mcp-tools` |
| F13 | Web dashboard | **P0** | C + D | `feat/c-`, `feat/d-` |
| F14 | VS Code extension | P2 | D | `feat/d-ext-` |
| F17 | Adaptive repository learning | P2 | B | `feat/b-adaptive-learning` |
| F18 | MCP intelligence layer | P2 | B | `feat/b-mcp-intelligence` |
| F19 | Auto-fix pull requests | P2 | B + D | `feat/b-auto-fix-pr` |
| F20 | Regression watching | P2 | B + D | `feat/b-auto-fix-pr` |

**P0 = the minimum credible demo.** F01–F06 plus F13. Finish and polish these
before touching anything else. P1 features are differentiators, added only once
the full P0 path works reliably end to end. P2 is stretch — it must never delay
P0 or destabilize the core investigation flow.

---

## 2. Build order

```
Phase 0  ── stabilization (A) ──────────► blocks everyone
              │
              ├── contract freeze (A) ───► unblocks C and D
              │
   ┌──────────┼──────────────┬──────────────┐
   │          │              │              │
Stream A   Stream B      Stream C       Stream D
memory     chain.py      lib + types    shell + primitives
   │       (F02 core)    (F02/F05)      (F13)
   │          │              │              │
runner ◄──── nodes       trace UI       escalation queue
(F01)      (F03/F04/F06) (F02/F06)      (F04/F10)
   │          │              │              │
   └──────────┴──────────────┴──────────────┘
                     │
              G3: chain streams end to end   ◄── the hero moment
                     │
              P1 features, then P2
```

**The critical path runs through F02.** `agents/chain.py` (B) → graph runner (A) →
`InvestigationTrace` (C). If that path is healthy by G3, the demo works. Protect
it ahead of everything else.

---

## 3. Ownership by feature

### F01 — GitHub integration & agentic monitoring · P0

| Part | Stream | Files |
|---|---|---|
| GitHub client + MCP tools | B | `mcp_server/github_client.py`, `tools.py` |
| Shared MCP session | A | `mcp_server/client.py` |
| Investigation trigger endpoint | A | `api/routes_investigations.py` |
| "Scan now" control | D | `AppShell`, `AgentStatusIndicator` |

**Demo requirement:** an event starts an investigation automatically.
**Cut per plan:** webhooks and the polling loop. A judge cannot see a cron job, and
webhooks need ngrok on venue wifi. Use a button; say it runs on a schedule in
production. That claim is true — the trigger path is identical.

### F02 — Multi-step investigation trace · P0 · **THE HERO**

| Part | Stream | Files |
|---|---|---|
| `@chain_step` decorator | B | `agents/chain.py` |
| Step persistence | A | `memory/repo.py` |
| Stream → WS → DB fan-out | A | `api/routes_investigations.py`, `api/ws.py` |
| Timeline UI | C | `InvestigationTrace.tsx`, `InvestigationStep.tsx` |

**Demo requirement:** completed, active, failed, and skipped steps are all visible.
**Safety:** structured trace only — tool used, timestamps, query category, record
counts, source IDs, classification, confidence, outcome. **Never hidden
chain-of-thought** (`docs/DESIGN.md` §7.3).

### F03 — Project-aware RAG · P0

Stream B. `rag/embedder.py`, `rag/retriever.py`.
**Demo requirement:** retrieved historical issues with real source links.
**Trap:** generic LLM output presented as RAG without retrieval evidence is an
explicit spec conflict (`docs/DESIGN.md` §4).

### F04 — Selective escalation · P0

B builds `agents/triage/decider.py`; D builds the queue UI.
**Demo requirement:** escalate an important case *and visibly suppress a low-value
one*. The suppression is the point — anyone can raise alarms.

### F05 — Explainability & feedback · P0

A builds `POST /api/feedback`; C builds `EvidenceCard` and `ApprovalPanel`.
**Cut:** feedback does not alter agent behavior during the hackathon. Log it,
display it, don't act on it.

### F06 — Semantic duplicate & regression detection · P0

B builds `find_duplicates`; C builds `SimilarIssueComparison`.
Thresholds: **>0.85 duplicate, 0.65–0.85 related**.
**The trap that will break your demo:** you must exclude the issue's own number
from results, or every issue is its own perfect duplicate.

### F07–F10 — P1 differentiators

Build only after the full P0 path is reliable.

- **F07 Security** — keyword layer is deterministic and demos reliably; the LLM
  confirmation layer is cut unless ahead. Findings are **private by default**: no
  public security label or comment without approval (`docs/DESIGN.md` §12).
- **F08 Auto-labeling** — auto-apply above 0.85 confidence, otherwise suggest only.
  Per the autonomy table, applying a label is approval-required by default.
- **F09 Incomplete-issue follow-up** — must name the specific missing fields, never
  a generic "please provide more details."
- **F10 Health** — the overall score must **always** reveal its components. A bare
  number is not evidence.

### F11–F14 — P2 stretch

- **F11 Weekly brief** — one LLM call, little visual payoff. First on the cut list.
- **F12 MCP server** — largely already built; expose it and demo with MCP Inspector.
- **F14 VS Code extension** — a companion, not a second product. Iframe the
  dashboard plus a real status bar item and tree view.

---

## 4. Cut list

In this order, without hesitation. Deciding now beats deciding at 4am.

| # | Cut | Why |
|---|---|---|
| 1 | F11 weekly brief | One LLM call, zero visual payoff |
| 2 | Agentic polling loop | Judges can't see a cron job; the button is equivalent |
| 3 | Webhooks | Needs ngrok and a public URL; dies on venue wifi |
| 4 | Health time series | Needs history you won't have — seed 7 points |
| 5 | F09 incomplete-issue | Overlaps the escalation path |
| 6 | F07 LLM security layer | Keep the deterministic keyword layer |
| 7 | Feedback affecting behavior | Log and display only |
| 8 | F14 VS Code extension | P2 companion; cut if the dashboard is at risk |

**Never cut:** F02 trace, F03 RAG, F04 escalation, F06 duplicates, F13 dashboard.
That set *is* the demo.

---

## 5. Explicitly out of scope

From `docs/DESIGN.md` §3. Do not let these back in without an explicit team
decision — several appear in older docs and will look tempting at 2am:

Docker bug-reproduction sandboxing · automatic code modification or merge · full
AST blast-radius analysis · reviewer matchmaking · contributor reputation scoring ·
toxicity scoring · documentation PR generation · flaky-test isolation ·
cross-organization analytics · a full terminal CLI.

`TECHSTACK.md` in the repo root describes several of these plus an OpenAI stack
that does not exist here. **It is stale.** Trust `docs/DESIGN.md` and `CLAUDE.md`.

---

## 6. Status tracking

`docs/DESIGN.md` §1 requires that features be labeled honestly. Keep this table
current in the README — a feature is `Implemented` only when it is merged to `main`
and demonstrated end to end.

| Status | Meaning |
|---|---|
| `Implemented` | Merged, verified end to end |
| `In progress` | Branch open, not merged |
| `Planned` | Contract written, no code |
| `Stretch` | Only if time allows |
| `Cut` | Explicitly dropped |

**Never mark a feature `Implemented` because the code exists.** It counts when it
runs in the demo path.
