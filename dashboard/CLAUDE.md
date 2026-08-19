# Doombot Dashboard — Shared Frontend Rules

**Read this before touching any file in `dashboard/`. Both Person C and Person D
read this file. `FRONTEND-C.md` and `FRONTEND-D.md` build on top of it and do
not repeat what's here.**

This file is scoped to `dashboard/`. It does not override root `CLAUDE.md` —
git workflow, non-negotiable rules, and workstream ownership boundaries are
defined there (root §2, §5, §6) and only referenced here.

**Also required reading: [`../docs/DESIGN-ADDENDUM.md`](../docs/DESIGN-ADDENDUM.md).**
`DESIGN.md` defines the tokens and principles; the addendum defines the numbers it
omits — type scale, z-index ladder, motion durations, elevation, severity ordering,
focus rings, keyboard bindings, and microcopy rules. It also documents a **verified
contrast audit** and a **real defect in the severity palette** (`--high` is brighter
than `--critical`, so on a dark UI the hierarchy inverts unless you encode severity
with fill, rule weight, and icon as well as hue). Do not invent any of those values
yourself — four people each inventing them is how one product starts looking
like four.

---

## 1. Purpose

The dashboard is Feature **F13** — "the primary complete product experience"
(DESIGN.md §3). It is not a side panel to the agent; for judges, it *is* the
product. Everything else (VS Code extension, MCP server, weekly brief) is
secondary to a dashboard that clearly answers DESIGN.md §5's three questions:
what happened, why did the agent decide that, what needs my attention.

---

## 2. The C/D split — why, and the file-ownership table

Two people cannot both edit `App.tsx` without stepping on each other every
hour. The split follows root `CLAUDE.md` §5: **Person C owns the investigation
surfaces (the hero), Person D owns the shell around it.** If you are unsure
which side a file is on, it is not yours — stop and ask, per root rule #2.

| Path | Owner | Notes |
|---|---|---|
| `src/lib/api.ts` | C | typed fetch wrappers |
| `src/lib/types.ts` | C | hand-mirrored `api/schemas.py` — **shared contract, C edits, D reads** |
| `src/lib/useSocket.ts` | C | the one WebSocket hook |
| `src/lib/format.ts` | C | duration/timestamp/confidence formatting |
| `src/components/InvestigationTrace.tsx` | C | THE HERO |
| `src/components/InvestigationStep.tsx` | C | |
| `src/components/EvidenceCard.tsx` | C | |
| `src/components/SimilarIssueComparison.tsx` | C | |
| `src/components/ConfidenceIndicator.tsx` | C | |
| `src/components/InvestigationList.tsx` | C | |
| `src/components/ApprovalPanel.tsx` | C | |
| `src/App.tsx` | D | routes, top-level providers |
| `src/components/AppShell.tsx` | D | sidebar, chrome |
| `src/components/RepositorySelector.tsx` | D | |
| `src/components/AgentStatusIndicator.tsx` | D | |
| `src/components/HealthScoreCard.tsx` | D | |
| `src/components/HealthMetricBreakdown.tsx` | D | |
| `src/components/HealthTrendChart.tsx` | D | |
| `src/components/EscalationTable.tsx` | D | |
| `src/components/EscalationPreview.tsx` | D | |
| `src/components/SeverityBadge.tsx` | D | |
| `src/components/AgentActivityFeed.tsx` | D | |
| `src/components/EmptyState.tsx` | D | **shared primitive — build first, see FRONTEND-D.md** |
| `src/components/ErrorState.tsx` | D | **shared primitive — build first** |
| `src/components/SkeletonState.tsx` | D | **shared primitive — build first** |

**Trap:** `types.ts` is C's file to edit, but D reads it constantly. If a type
C needs doesn't exist yet, C adds it — D does not fork a duplicate type in
another file. There is exactly one source of truth for a shape in the
frontend, matching root rule that `schemas.py` has exactly one mirror.

---

## 3. Scaffolding

Run once, from `dashboard/`:

```bash
npm create vite@latest . -- --template react-ts
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npx shadcn@latest init
npm install recharts lucide-react
npm run dev          # http://localhost:5173
```

Whoever runs this first commits it as `chore(dashboard): scaffold vite + tailwind + shadcn`
on `feat/c-scaffold` or `feat/d-scaffold` — announce in chat before running it
twice.

### Planned `src/` tree

```text
src/
  main.tsx
  App.tsx                              D
  index.css                            tokens + tailwind layers (shared, see §4)
  lib/
    api.ts                             C
    types.ts                           C — hand-mirrored api/schemas.py
    useSocket.ts                       C
    format.ts                          C
  components/
    ui/                                shadcn-generated primitives (button, card, dialog, table, ...)
    AppShell.tsx                       D
    RepositorySelector.tsx             D
    AgentStatusIndicator.tsx           D
    HealthScoreCard.tsx                D
    HealthMetricBreakdown.tsx          D
    HealthTrendChart.tsx               D
    EscalationTable.tsx                D
    EscalationPreview.tsx              D
    SeverityBadge.tsx                  D
    AgentActivityFeed.tsx              D
    EmptyState.tsx                     D (shared primitive)
    ErrorState.tsx                     D (shared primitive)
    SkeletonState.tsx                  D (shared primitive)
    InvestigationTrace.tsx             C
    InvestigationStep.tsx              C
    EvidenceCard.tsx                   C
    SimilarIssueComparison.tsx         C
    ConfidenceIndicator.tsx            C
    InvestigationList.tsx              C
    ApprovalPanel.tsx                  C
```

Do not create files outside this tree without updating this table first
(root rule #2 — never invent a filename).

---

## 4. Design tokens — copied verbatim from DESIGN.md §8

**Do not restate these from memory, do not "improve" the palette, do not use
a default Tailwind color or a raw hex anywhere in `dashboard/`.** Every color
in the UI must resolve to one of these tokens. This is graded — a PR that
introduces `bg-gray-800` or `text-red-500` is not mergeable.

Put this in `src/index.css`, under `@layer base`:

```css
:root {
  --background: #070a08;
  --surface-1: #0d120f;
  --surface-2: #101713;
  --surface-3: #17211b;
  --border: #24332a;

  --text-primary: #f1f5f2;
  --text-secondary: #b6c2ba;
  --text-muted: #87958c;

  --accent: #22c55e;
  --accent-bright: #4ade80;
  --accent-muted: #163d25;

  --critical: #f43f5e;
  --high: #fb7185;
  --warning: #f59e0b;
  --information: #38bdf8;
  --success: #22c55e;
  --neutral: #94a3b8;
}
```

`tailwind.config.ts` maps every one of those to a Tailwind color name — no
exceptions, no extra colors invented on the side:

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        border: "var(--border)",
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          bright: "var(--accent-bright)",
          muted: "var(--accent-muted)",
        },
        critical: "var(--critical)",
        high: "var(--high)",
        warning: "var(--warning)",
        information: "var(--information)",
        success: "var(--success)",
        neutral: "var(--neutral)",
      },
    },
  },
};
```

Usage: `bg-surface-2`, `text-text-secondary`, `border-border`, `text-critical`.
**Never** `bg-[#101713]`, **never** `bg-slate-800`.

---

## 5. Typography, spacing, radius, controls

Per DESIGN.md §8:

- **Font**: `Inter` or `Geist` for UI. `Geist Mono` or `JetBrains Mono` for
  code and evidence snippets (issue bodies, diffs, source refs).
- **Minimum body text**: 14px on desktop. No 12px paragraph text.
- **Spacing base unit**: 4px. Use gaps of 8 / 12 / 16 / 24 / 32px — pick from
  this scale, don't invent a 20px gap because it looked nicer.
- **Radius**: 8–12px on cards, dialogs, buttons.
- **Controls** (buttons, inputs, selects): 36–40px tall.
- **Dense table rows** (EscalationTable, InvestigationList): 32–36px.
- One border system, one shadow system — shadcn's defaults, tokenized to
  `--border` above. Do not add a second shadow scale.

---

## 6. Lucide icon mapping (DESIGN.md §8)

Use these and only these for the listed meanings — consistency here is what
makes the UI scannable at a glance instead of read line-by-line.

| Meaning | Icon |
|---|---|
| Security | `ShieldAlert` |
| Pull request | `GitPullRequest` |
| Issue | `CircleDot` |
| Investigation | `Search` |
| Agent | `BrainCircuit` |
| Health | `Activity` |
| Evidence history | `History` |
| Approved | `BadgeCheck` |
| Escalation | `TriangleAlert` |

If you need an icon not on this list (e.g. a chevron, a close button), pick
the closest semantic Lucide icon and don't invent a second icon set.

---

## 7. The twelve UI states — every data-driven screen, checked against this

DESIGN.md §10 is explicit: a screen is not done until it handles all twelve.
Treat this as a literal checklist per component/screen, not a vibe.

- [ ] Initial loading
- [ ] Background refreshing (data exists, a refetch is in flight)
- [ ] Empty result (query succeeded, zero items)
- [ ] Partial data (some fields missing/null — don't crash, don't fake it)
- [ ] Authentication failure
- [ ] GitHub rate limiting
- [ ] Agent or model failure
- [ ] RAG index unavailable
- [ ] Stale data (show an age/staleness indicator, don't silently serve old data as fresh)
- [ ] Permission denied
- [ ] Successful action
- [ ] Action awaiting approval

`EmptyState`, `ErrorState`, and `SkeletonState` (owned by D, see
`FRONTEND-D.md`) exist specifically so every screen can satisfy this list
without reinventing loading/error UI per component. If a component you're
building needs a state not covered by those three primitives' variants, flag
it to D rather than hand-rolling a fourth pattern.

---

## 8. Accessibility (DESIGN.md §11)

- Full keyboard access to queue navigation and approval controls — this is
  not optional polish, it's how a judge or a maintainer using a keyboard
  triages 30 escalations in the demo.
- Visible focus states on every interactive element (shadcn gives you this
  by default — do not strip `focus-visible` outlines with a custom class).
- Semantic headings and landmarks (`<nav>`, `<main>`, `<h1>`/`<h2>` hierarchy)
  — not a soup of `<div>`s with click handlers.
- Icon-only buttons get an accessible name (`aria-label`), always. An icon
  next to text does not need a redundant label.
- WCAG AA contrast for normal text against whatever surface token it sits on.
- **Status must never be communicated by color alone.** A critical escalation
  is red *and* says "Critical" *and* shows `TriangleAlert`. This is graded —
  a severity badge that is only a colored dot fails review.
- Respect `prefers-reduced-motion`: anything that animates (the trace
  timeline, toasts, transitions) must have a reduced/instant fallback.
- Tables collapse to stacked cards at narrow (tablet) width — desktop is
  primary per DESIGN.md §11, but don't hard-break at tablet width either.
- Charts (HealthTrendChart) need an accessible summary or backing data table,
  not just an SVG.
- Dialogs (ApprovalPanel confirmations, etc.) trap focus while open and
  return focus to the triggering control on close.

---

## 9. Safety rules the UI must enforce (DESIGN.md §12)

These are not style preferences — DESIGN.md §4 calls violating them a
**"conflicts with the specification"** verdict, the most severe category.

1. **Never render hidden chain-of-thought.** The API only ever gives you a
   structured `StepRecord` (tool used, timestamps, query category, record
   counts, source ids, classification, confidence, outcome, error/skip
   reason). If a field looks like raw model reasoning rather than one of
   those structured fields, do not display it — flag it to the backend
   owner (Person A/B), don't just render whatever `output_summary` contains.
2. **Never display tokens or secrets.** If a string in an API response looks
   like a credential, don't render it verbatim — this should never happen
   given backend redaction, but the frontend is not exempt from the rule.
3. **Suspected security findings are private by default.** No escalation UI
   may expose a "post public security label/comment" action without an
   explicit approval step in front of it. See ApprovalPanel spec in
   `FRONTEND-C.md` and the escalation actions in `FRONTEND-D.md`.
4. **Confidence is shown with meaning, not decorative precision.** Render
   `"High confidence — strong semantic match"`, never `"94.3728%"`. See
   `ConfidenceIndicator` in `FRONTEND-C.md` for the exact banding.

---

## 10. WebSocket contract and reconnect strategy

- Endpoint: `ws://localhost:8000/ws`.
- Envelope: `{ type: string, data: unknown }`.
- Event types: `step.started`, `step.completed`, `investigation.completed`,
  `activity`.
- **Reconnect with exponential backoff** (e.g. 1s, 2s, 4s, 8s, capped at
  ~30s). Show the connection state in the app chrome (`AgentStatusIndicator`,
  owned by D) at all times — connected, reconnecting, offline.
- **On reconnect, refetch the investigation detail via REST** to resync.
  Do not assume the WS stream picks up where it left off.

**Why:** WS events can be missed entirely while disconnected — there is no
message replay on the socket. SQLite via REST is the authoritative store
(root `CLAUDE.md` §4: persistence and replay both come from the same
`chain_step` decorator). The WebSocket is a **live overlay** on top of that
truth, not a second source of truth. Treat any divergence between what the
socket implies and what a REST refetch returns as "REST wins."

---

## 11. Mock-first workflow

Per root `CLAUDE.md` §7 and `docs/PLAN.md`'s H2 gate: Person A freezes
`api/schemas.py` and ships **every endpoint returning hardcoded fixtures**
at hour 2. Frontend must never be blocked waiting on real backend logic.

Additionally, support a zero-backend mode via an env flag:

```bash
# .env.local
VITE_USE_MOCKS=true
```

```typescript
// src/lib/api.ts (shape, not full implementation)
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

export async function getInvestigation(id: string): Promise<InvestigationDetail> {
  if (USE_MOCKS) return mockInvestigationDetail(id);
  const res = await fetch(`${API_BASE}/api/investigations/${id}`);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}
```

This means a laptop with no backend running, no venue wifi, and no Groq key
can still demo the dashboard shell and the trace animation off local fixture
data. Both C and D should keep a small set of realistic fixtures matching
`types.ts` shapes — not `{ foo: "bar" }` placeholders.

---

## 12. Conventions

- Functional components + hooks only. No class components.
- **Named exports only.** No default exports — `export function EvidenceCard(...)`,
  not `export default function`.
- One component per file. File name matches the component name.
- **PascalCase** filenames for components (`EvidenceCard.tsx`), camelCase for
  lib files (`useSocket.ts`, `format.ts`).
- Props interfaces are named `<Component>Props` — `EvidenceCardProps`, not
  `Props` or `IEvidenceCardProps`.
- No inline styles (`style={{...}}`). Tailwind classes only, using the
  tokens from §4.
- **No `any`.** If a shape is genuinely unknown (e.g. a WS envelope payload
  before narrowing by `type`), type it `unknown` and narrow it, don't
  silence the compiler.

---

## 13. Definition of done for a UI feature

Adapted from DESIGN.md §14. A component or screen is not done until:

- [ ] Maps to an approved feature ID (F01–F14) — cited in the PR description
- [ ] Uses only the tokens in §4 and shared primitives (`EmptyState`,
      `ErrorState`, `SkeletonState`, shadcn `ui/` components)
- [ ] All applicable states from the twelve in §7 are implemented, not just
      loading/success
- [ ] Keyboard operation and focus behavior verified by hand
- [ ] Actions correctly reflect the approval policy (DESIGN.md §12) — nothing
      destructive or public fires without an approval step
- [ ] No secret, raw token, or hidden chain-of-thought is rendered
- [ ] Checked at desktop and tablet width
- [ ] Verified against realistic fixture/mock data, not `{}`
- [ ] Rebased onto `origin/main`, PR filled out per root `CLAUDE.md` §6
      template, branch prefixed `feat/c-` or `feat/d-`
