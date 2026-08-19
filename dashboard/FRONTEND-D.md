# Person D — Frontend Shell + Overview + VS Code

**Read `dashboard/CLAUDE.md` first**, then
[`../docs/DESIGN-ADDENDUM.md`](../docs/DESIGN-ADDENDUM.md). This file assumes you
already know the tokens, the twelve states, the icon map, and the conventions.

**Addendum §2 is mandatory for `SeverityBadge` and `EscalationTable`** — the
severity palette inverts visually on dark backgrounds (`--high` is brighter than
`--critical`), so severity must be encoded with fill, rule thickness, icon, and the
severity word, not hue alone. Addendum §10 specifies the three shared state
primitives you own, and §11 the escalation-queue keyboard bindings.

You own the app chrome, the overview screen, the escalation queue, and
project health. You also own `vscode-extension/` — see
`vscode-extension/CLAUDE.md` for that half of your work.

**Feature IDs owned: F01 (agentic monitoring, surfaced via
AgentStatusIndicator/AgentActivityFeed), F04 (selective escalation, the
EscalationTable/Preview), F10 (project-health analysis), F13 (web dashboard
as a whole — you own the shell it all sits inside).**

Branch prefix: `feat/d-<slug>`.

---

## Files you own

```text
src/App.tsx
src/components/AppShell.tsx
src/components/RepositorySelector.tsx
src/components/AgentStatusIndicator.tsx
src/components/HealthScoreCard.tsx
src/components/HealthMetricBreakdown.tsx
src/components/HealthTrendChart.tsx
src/components/EscalationTable.tsx
src/components/EscalationPreview.tsx
src/components/SeverityBadge.tsx
src/components/AgentActivityFeed.tsx
src/components/EmptyState.tsx
src/components/ErrorState.tsx
src/components/SkeletonState.tsx
```

You do not touch C's files (`src/lib/*`, `Investigation*`, `Evidence*`,
`SimilarIssueComparison.tsx`, `ConfidenceIndicator.tsx`, `ApprovalPanel.tsx`).
You **do** import and read from `src/lib/types.ts` and call functions from
`src/lib/api.ts` — those are C's to edit, yours to consume.

---

## Build `EmptyState`, `ErrorState`, `SkeletonState` FIRST

**This is not a suggestion — it's a sequencing requirement.** These three
are shared primitives. C's `InvestigationList` and `InvestigationTrace`
both depend on them for their loading/empty states (see
`dashboard/FRONTEND-C.md`). If you build these last, C either blocks on you
or hand-rolls a throwaway version that then has to be swapped out —
duplicate work either way. Make these your first PR, before any other
component in this file.

### `EmptyState.tsx`

```typescript
export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}
```

### `ErrorState.tsx`

```typescript
export type ErrorKind =
  | "auth"
  | "rate_limited"
  | "agent_failure"
  | "rag_unavailable"
  | "permission_denied"
  | "network"
  | "unknown";

export interface ErrorStateProps {
  kind: ErrorKind;
  message?: string;          // override the default copy for `kind`
  onRetry?: () => void;
}
```

`kind` exists so every screen renders *consistent* copy for the same
failure instead of each component inventing its own error text — this
single component is how the "authentication failure / GitHub rate
limiting / agent or model failure / RAG index unavailable / permission
denied" entries in the twelve-states checklist actually get implemented
app-wide, once.

### `SkeletonState.tsx`

```typescript
export interface SkeletonStateProps {
  variant: "list" | "card" | "table-row" | "text";
  count?: number;             // repeat for lists/rows, default 1
}
```

**Acceptance criteria for all three:**

- [ ] Zero business logic — pure presentational, take primitives/callbacks only
- [ ] `ErrorState` renders distinct copy + icon per `ErrorKind` (text, not
      just a generic "Something went wrong")
- [ ] `SkeletonState` respects `prefers-reduced-motion` (no shimmer
      animation when reduced motion is requested — a static gray block is fine)
- [ ] All three pass the "legible without color" check from
      `dashboard/CLAUDE.md` §8

---

## `AppShell.tsx` and `App.tsx` — routing

Recommend **`react-router-dom`** with the routes from DESIGN.md §6, kept
flat — **no nested layouts.** A nested-route tree buys you nothing at this
scale and costs debugging time neither of you has:

```text
/                    redirect to /overview
/overview            F01, F10 summary — Overview screen
/escalations         F04 — Escalation queue
/investigations      F02 — Investigation list (C's InvestigationList)
/investigations/:id  F02 — Investigation detail (C's InvestigationTrace + friends)
/health              F10 — Project-health page
```

`docs/DESIGN.md` §6 also lists `/history`, `/briefs`, `/policies`,
`/settings` as recommended IA — those map to F11/F12/F07-09 territory
outside this hackathon's P0 scope (root scope table, DESIGN.md §3). Leave
stub routes or nav entries only if there's spare time; do not build full
screens for them without an explicit scope decision, per DESIGN.md §4's
scope-checking protocol.

```typescript
// src/App.tsx (shape)
export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/escalations" element={<EscalationsPage />} />
          <Route path="/investigations" element={<InvestigationsPage />} />
          <Route path="/investigations/:id" element={<InvestigationDetailPage />} />
          <Route path="/health" element={<HealthPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
```

```typescript
// src/components/AppShell.tsx
export interface AppShellProps {
  children: React.ReactNode;
}
```

`AppShell` renders the persistent chrome from DESIGN.md §6: collapsible
left sidebar (nav to the five routes above), `RepositorySelector`, a
search/command-menu placeholder if time allows (cut first if not),
`AgentStatusIndicator` (WS connection state + GitHub connection state +
last sync time), user/profile menu (can be a static placeholder — no auth
system in this MVP).

**Accessibility:** sidebar nav uses `<nav>` with `aria-label`, current route
indicated with `aria-current="page"` (not just a highlighted background).

---

## `RepositorySelector.tsx`

**Feature ID:** F01 (repository being monitored is the unit of everything
else).

```typescript
export interface RepositorySelectorProps {
  repos: RepoSummary[];
  selectedRepo?: RepoSummary;
  onSelect: (repo: RepoSummary) => void;
  onIndexRequested: (repo: RepoSummary) => Promise<void>;   // POST /api/repos/{owner}/{repo}/index
  isIndexing?: boolean;
}
```

**States:** empty (no repos connected yet — `EmptyState` with an action to
add one, or however repo connection is scoped), loading, and a distinct
"indexing" in-progress state driven by `isIndexing` (this maps to the RAG
index being built — related to F03/"RAG index unavailable" in the twelve
states, since a repo mid-index is functionally in that state for any
investigation UI depending on it).

**Accessibility:** a real `<select>`/combobox pattern (shadcn `Select` or
`Combobox`), keyboard operable, not a custom div-based dropdown without
ARIA roles.

**Acceptance criteria:**

- [ ] Selecting a repo persists across a route change within the session
- [ ] Indexing state is visibly distinct from "ready" (icon + text, not a
      spinner alone with no label)

---

## `AgentStatusIndicator.tsx`

**Feature ID:** F01.

```typescript
export interface AgentStatusIndicatorProps {
  connectionState: "connecting" | "connected" | "reconnecting" | "offline";
  githubConnected: boolean;
  lastSyncAt: string | null;
}
```

Lives in `AppShell`. Uses `BrainCircuit` (agent, per the icon map) alongside
a text label — `"Agent: Active"`, `"Agent: Reconnecting"`, etc., matching
the Overview sketch in DESIGN.md §7.1 (`Agent: Active` in the top bar).
GitHub connection uses a distinct indicator (not the same dot reused) since
they're independently failing states — WS can be down while GitHub is fine,
or vice versa; conflating them hides which one to debug during the demo.

**Acceptance criteria:**

- [ ] All four connection states render distinct text + icon
- [ ] `lastSyncAt` renders via relative time (`format.ts` from C, e.g.
      `formatRelativeTime`) and updates without a full page reload

---

## Overview page — layout (DESIGN.md §7.1, ASCII sketch verbatim)

```text
+-------------------------------------------------------------+
| Repository             Last sync            Agent: Active   |
+------------+------------+------------+----------------------+
| Health 84  | Critical 3 | Pending 12 | Response time -18%   |
+-------------------------+-----------------------------------+
| Project health trend    | Agent activity                    |
|                         | Investigated #142                 |
|       chart             | Found regression #97             |
|                         | Waiting for approval              |
+-------------------------+-----------------------------------+
| Important escalations                                       |
+-------------------------------------------------------------+
```

Required content per DESIGN.md §7.1: repository selector + sync status,
health score with component breakdown (not the bare number — see the
weighting rule below), open escalation counts by severity, pending approval
count, agent activity feed, health trend chart, highest-priority escalation
list, last scan / next reconciliation time. Build the Overview page itself
as a thin composition of `HealthScoreCard`, `AgentActivityFeed`,
`HealthTrendChart`, and a slice of `EscalationTable` — don't duplicate their
logic inline.

---

## `HealthScoreCard.tsx` + `HealthMetricBreakdown.tsx`

**Feature ID:** F10.

**The weighting (DESIGN.md §7.5) — the overall score must ALWAYS reveal its
components. This is a hard rule, not a layout preference**: a bare "Health:
84" with nothing else is a spec violation.

```text
Response health       25%
Backlog stability     20%
Issue resolution      20%
PR responsiveness     15%
Contributor activity  10%
Duplicate rate        10%
```

```typescript
export interface HealthComponentScore {
  key: "response" | "backlog" | "resolution" | "pr_responsiveness" | "contributor" | "duplicate_rate";
  label: string;
  weight: number;       // 0.25, 0.20, 0.20, 0.15, 0.10, 0.10
  score: number;        // 0-100
}

export interface HealthScoreCardProps {
  overallScore: number;             // 0-100
  components: HealthComponentScore[];
  trend?: "up" | "down" | "flat";
  onViewBreakdown?: () => void;     // e.g. scroll to / open HealthMetricBreakdown
}

export interface HealthMetricBreakdownProps {
  components: HealthComponentScore[];
}
```

`HealthScoreCard` shows the overall number *plus* a compact breakdown
(mini bars or a legend) inline — `HealthMetricBreakdown` is the fuller,
standalone version used on the `/health` page. Both read from the same
`components` shape so the weights never drift between the two views.

**Acceptance criteria:**

- [ ] `HealthScoreCard` never renders `overallScore` without at least a
      compact view of `components` alongside it
- [ ] Weights sum to 1.0 across the six components — if backend ever sends
      different weights, render what it sends rather than hardcoding the
      table above as UI-side truth (the numbers above are the *initial*
      config per DESIGN.md §7.5 — repos may configure them differently)
- [ ] Each component score has a label, not just a bar

---

## `HealthTrendChart.tsx`

**Feature ID:** F10.

```typescript
export interface HealthTrendPoint {
  date: string;          // ISO date
  score: number;
  annotation?: { label: string; kind: "release" | "incident" | "policy_change" | "unusual_activity" };
}

export interface HealthTrendChartProps {
  data: HealthTrendPoint[];
}
```

Use Recharts (per `dashboard/CLAUDE.md` §3 install list and DESIGN.md §9).
Annotations render as reference markers on the line per DESIGN.md §7.5
("event annotations for releases, incidents, policy changes, and unusual
activity").

**Accessibility:** per `dashboard/CLAUDE.md` §8, ship an accessible summary
or backing data table alongside the chart — e.g. a visually-hidden
`<table>` with the same `data`, or a text summary like "Health rose from 71
to 84 over the last 30 days." Don't ship the chart as the only way to get
this information.

**Acceptance criteria:**

- [ ] Renders with zero data points as an empty state, not a broken chart
- [ ] Annotations are visually distinct per `kind` (icon/label, not color
      alone)
- [ ] An accessible non-visual equivalent of the trend exists in the DOM

---

## Escalation queue — `EscalationTable.tsx` + `EscalationPreview.tsx` + `SeverityBadge.tsx`

**Feature ID:** F04. Per DESIGN.md §7.2, this is a maintainer inbox — speed
and low noise matter more than density of information per row.

**Row format (DESIGN.md §7.2, verbatim example):**

```text
[CRITICAL] Possible authentication bypass          94% confidence
#142 - security - opened 12 minutes ago             Review ->
```

Note: the confidence in that literal example is a raw percentage in the
spec's illustration, but `dashboard/CLAUDE.md` §9 and DESIGN.md §10 require
meaning-first display everywhere else in the product — apply
`ConfidenceIndicator`/`confidenceLabel` (C's `format.ts`) to this row too
for consistency, showing something like `"[CRITICAL] Possible
authentication bypass — High confidence"`, with the precise number only in
a tooltip if at all. Treat the spec's row as a content/layout reference,
not a license to reintroduce bare percentages.

```typescript
export type EscalationSeverity = "critical" | "high" | "warning" | "info";
export type EscalationStatus = "pending" | "approved" | "rejected" | "corrected";

export interface EscalationRow {
  id: string;
  severity: EscalationSeverity;
  category: string;             // e.g. "security", "regression"
  title: string;
  issueRef: string;
  confidence: number;           // 0-1
  openedAt: string;
  status: EscalationStatus;
  isPublicVisibility: boolean;  // false = private/security-sensitive (DESIGN.md §7.6, §12)
}

export interface EscalationTableProps {
  rows: EscalationRow[];
  selectedId?: string;
  onSelect: (id: string) => void;
  filters: EscalationFilters;
  onFiltersChange: (filters: EscalationFilters) => void;
}

export interface EscalationFilters {
  severity?: EscalationSeverity[];
  category?: string[];
  minConfidence?: number;
  status?: EscalationStatus[];
}

export interface EscalationPreviewProps {
  escalation: EscalationRow | null;   // null = nothing selected
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onCorrect: (id: string, note: string) => Promise<void>;
  onOpenInvestigation: (investigationId: string) => void;
}

export interface SeverityBadgeProps {
  severity: EscalationSeverity;
}
```

**Layout:** split view, queue (`EscalationTable`) on the left, detail
(`EscalationPreview`) on the right, per DESIGN.md §7.2. This is a
Linear-Triage-style pattern (DESIGN.md §13's recommended synthesis).

**Behavior:**

- Filter by severity, category, confidence, and status (repository and
  assignee filters from the full spec are out of scope for MVP unless time
  allows — flag rather than silently building them).
- Sort by priority/confidence/age — pick one sensible default (e.g.
  severity then confidence) and expose a sort control if time allows.
- **Keyboard next/prev navigation** through the queue (e.g. `j`/`k` or
  arrow keys) that updates the preview pane — this is explicitly required
  by DESIGN.md §7.2 and `dashboard/CLAUDE.md` §8, not optional polish.
- Approve / reject / correct / open-investigation actions live in the
  preview pane. "Assign" from the full spec is out of scope for MVP (no
  multi-user assignee model here) unless explicitly added later.
- **Clear public-vs-private indication**: `isPublicVisibility: false` rows
  render a distinct marker (e.g. a lock icon + "Private" text) — this is
  the UI enforcement of DESIGN.md §12's "publish security finding:
  prohibited by default" rule. A security-flagged escalation must never
  look identical to a public one in this table.

**`SeverityBadge`** maps `critical`→`--critical`, `high`→`--high`,
`warning`→`--warning`, `info`→`--information` (tokens from
`dashboard/CLAUDE.md` §4) — always paired with the text label
("Critical", "High", …) and, where space allows, `TriangleAlert` for
escalation-flavored severities per the icon map.

**States:** empty ("Queue is clear" — a genuinely good state, phrase it
positively, not as a generic empty state), all filter combinations that
return zero rows (distinguish "no escalations at all" from "no escalations
match your filters" — the latter needs a "clear filters" action).

**Accessibility:** table converts to stacked cards at narrow width
(`dashboard/CLAUDE.md` §8). Keyboard nav must not conflict with normal tab
order — implement as explicit key handlers scoped to the queue container,
documented with a visible hint.

**Acceptance criteria:**

- [ ] Keyboard next/prev moves the preview selection and is visually
      indicated on the table row
- [ ] Filtering to zero results is distinguishable from a genuinely empty
      queue
- [ ] Private/security escalations are visually distinct from public ones,
      not just labeled in a tooltip
- [ ] Approve/reject/correct call through to feedback and reflect the new
      `status` without a full page reload
- [ ] `SeverityBadge` is legible with color removed

---

## `AgentActivityFeed.tsx`

**Feature ID:** F01.

```typescript
export interface ActivityItem {
  id: string;
  message: string;             // "Investigated #142", "Found regression #97"
  timestamp: string;
  kind: "investigation" | "escalation" | "approval_needed" | "action_taken";
}

export interface AgentActivityFeedProps {
  items: ActivityItem[];
  live?: boolean;               // subscribe to WS "activity" events
  maxItems?: number;
}
```

Feeds from the WS `activity` event type (consumed via C's `useSocket` — you
call the hook, you don't modify its file) and/or REST on load, matching the
Overview sketch's "Agent activity" panel. New items prepend; respect
reduced-motion for any prepend animation.

**Acceptance criteria:**

- [ ] Feed order is newest-first and stable (no reordering existing items
      on new arrivals)
- [ ] `live={false}` renders a static snapshot correctly (used in contexts
      without a socket, e.g. VS Code webview fallback)

---

## Task breakdown

| Task | Files | Branch | Depends on | Feature ID |
|---|---|---|---|---|
| Shared primitives (build FIRST) | `EmptyState.tsx`, `ErrorState.tsx`, `SkeletonState.tsx` | `feat/d-shared-states` | — | — |
| Scaffold + tokens (if not already done by C) | `dashboard/` root config | `feat/d-scaffold` | — | — |
| AppShell + routing | `App.tsx`, `AppShell.tsx` | `feat/d-app-shell` | `feat/d-shared-states` | F13 |
| RepositorySelector | `RepositorySelector.tsx` | `feat/d-repo-selector` | `feat/d-app-shell` | F01 |
| AgentStatusIndicator | `AgentStatusIndicator.tsx` | `feat/d-agent-status` | `feat/d-app-shell`, C's `useSocket` | F01 |
| SeverityBadge | `SeverityBadge.tsx` | `feat/d-severity-badge` | — | F04 |
| HealthScoreCard + HealthMetricBreakdown | both files | `feat/d-health-score` | `feat/d-shared-states` | F10 |
| HealthTrendChart | `HealthTrendChart.tsx` | `feat/d-health-trend` | `feat/d-shared-states` | F10 |
| EscalationTable + EscalationPreview | both files | `feat/d-escalation-queue` | `feat/d-severity-badge`, `feat/d-shared-states` | F04 |
| AgentActivityFeed | `AgentActivityFeed.tsx` | `feat/d-activity-feed` | `feat/d-shared-states`, C's `useSocket` | F01 |
| Overview page composition | route/page composing the above | `feat/d-overview-page` | all of the above | F01, F10 |

---

## Definition of done

See `dashboard/CLAUDE.md` §13 for the full shared checklist. Additionally,
for this workstream specifically:

- [ ] `EmptyState`/`ErrorState`/`SkeletonState` shipped and stable before C
      needs them — check with C before reworking their props after they've
      been adopted
- [ ] No health score anywhere renders without its component breakdown
      visible or one click away
- [ ] Escalation queue keyboard navigation works end-to-end (select → next
      → approve) without touching the mouse
- [ ] Private/security escalations are never visually indistinguishable
      from public ones
- [ ] Routes match DESIGN.md §6's list, flat, no nested layouts
