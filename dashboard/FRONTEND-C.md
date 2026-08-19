# Person C — Frontend Core

**Read `dashboard/CLAUDE.md` first.** This file assumes you already know the
tokens, the twelve states, the icon map, and the conventions — it does not
repeat them.

You own the investigation and evidence surfaces. This is the hero of the
demo: DESIGN.md §5 says the visual design must always make three questions
easy to answer, and two of those three ("why did the agent make this
recommendation", "what needs my attention") are answered almost entirely by
the components in this file.

**Feature IDs owned: F02 (multi-step investigation trace), F03 (project-aware
RAG, surfaced via evidence/similar-issue), F05 (explainability and
feedback), F06 (semantic duplicate/regression detection, surfaced via
SimilarIssueComparison).**

Branch prefix: `feat/c-<slug>`.

---

## Files you own

```text
src/lib/api.ts
src/lib/types.ts
src/lib/useSocket.ts
src/lib/format.ts
src/components/InvestigationTrace.tsx
src/components/InvestigationStep.tsx
src/components/EvidenceCard.tsx
src/components/SimilarIssueComparison.tsx
src/components/ConfidenceIndicator.tsx
src/components/InvestigationList.tsx
src/components/ApprovalPanel.tsx
```

You do not touch `App.tsx`, `AppShell.tsx`, or anything under D's list in
`dashboard/CLAUDE.md` §2. If you need a shell-level change (e.g. a new route
param), ask D — don't edit `App.tsx` yourself.

---

## `src/lib/types.ts` — the hand-mirrored contract

This is the single most important file you own. It is the frontend half of
`api/schemas.py` (root `CLAUDE.md` §7). **There is no codegen.** If backend
changes `schemas.py`, this file changes in the same PR as the backend change
— but since you own this file, in practice that means: watch `api/schemas.py`
diffs, and if you see one land without a matching `types.ts` update, that PR
is broken regardless of who authored it.

Exact shapes, mirrored from the frozen contract:

```typescript
// src/lib/types.ts

export type StepStatus = "running" | "done" | "error";

export interface Evidence {
  type: "issue" | "pr" | "file" | "rule";
  ref: string;
  score: number;
  snippet: string;
}

export interface StepRecord {
  step_id: string;
  investigation_id: string;
  seq: number;
  name: string;
  title: string;
  status: StepStatus;
  input_summary: string;
  output_summary: string;
  evidence: Evidence[];
  duration_ms: number | null;
  started_at: string;   // ISO 8601
  ended_at: string | null;
}

// InvestigationSummary / InvestigationDetail / Escalation / HealthBreakdown /
// HealthResponse / RepoSummary shapes come from api/schemas.py — mirror each
// field 1:1, same names, same optionality. Do not rename a field to be more
// "TypeScript-y" (e.g. do not turn started_at into startedAt) — the wire
// format is snake_case and staying literal avoids a translation layer bug
// class entirely.

export interface WsEnvelope<T = unknown> {
  type: "step.started" | "step.completed" | "investigation.completed" | "activity";
  data: T;
}
```

**Trap:** do not add a field to a type here that doesn't exist in
`schemas.py` just because a component would be convenient with it. Derive it
in the component or in `format.ts` instead. `types.ts` is a mirror, not a
view model.

---

## `src/lib/useSocket.ts` — the one WebSocket hook

Exact signature:

```typescript
// src/lib/useSocket.ts

interface UseSocketOptions {
  url: string;                                   // ws://localhost:8000/ws
  onEvent: (envelope: WsEnvelope) => void;
  enabled?: boolean;                              // default true
}

type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

interface UseSocketResult {
  connectionState: ConnectionState;
  lastEventAt: string | null;                     // ISO timestamp, for staleness
}

export function useSocket(options: UseSocketOptions): UseSocketResult;
```

Behavior (see `dashboard/CLAUDE.md` §10 for the why):

- Exponential backoff on disconnect: 1s, 2s, 4s, 8s, 16s, capped at 30s.
- `connectionState` transitions: `connecting` → `connected` → (on drop)
  `reconnecting` → `connected`, or `offline` after backoff gives up (cap
  retry count or keep retrying forever at the 30s ceiling — forever is fine
  for a hackathon demo, just don't hammer the server every 100ms).
- On every successful (re)connection **after the first**, the caller (you,
  in `InvestigationTrace`) is responsible for refetching via REST — the hook
  itself does not know which investigation is open. Expose the transition
  clearly enough that the consumer can trigger a refetch on
  `reconnecting → connected`.
- One socket for the whole app. `AppShell` (D's file) also needs
  `connectionState` for the global chrome indicator — so this hook should be
  usable from a single shared instance (e.g. called once high in the tree
  and passed down, or wrapped in a tiny context). Coordinate with D on
  exactly where it's instantiated since both of you consume its output;
  the hook's *implementation* file is yours regardless.

---

## `src/lib/api.ts`

Typed fetch wrappers, one function per endpoint, all returning `types.ts`
shapes:

```typescript
// src/lib/api.ts (shape)

export class ApiError extends Error {
  constructor(public status: number, public body: string) { super(body); }
}

export function getHealth(): Promise<{ ok: boolean }>;
export function getRepos(): Promise<RepoSummary[]>;
export function indexRepo(owner: string, repo: string): Promise<void>;
export function getRepoHealth(owner: string, repo: string): Promise<HealthResponse>;
export function createInvestigation(req: CreateInvestigationRequest): Promise<InvestigationSummary>;
export function listInvestigations(): Promise<InvestigationSummary[]>;
export function getInvestigation(id: string): Promise<InvestigationDetail>;
export function listEscalations(): Promise<Escalation[]>;
export function postFeedback(req: FeedbackRequest): Promise<void>;
export function getBrief(owner: string, repo: string): Promise<BriefResponse>;
```

Respect `VITE_USE_MOCKS` per `dashboard/CLAUDE.md` §11 in every one of these.

---

## `src/lib/format.ts`

Pure formatting helpers, no JSX, no React:

```typescript
// src/lib/format.ts (shape)

export function formatDuration(ms: number | null): string;      // "1.2s", "340ms", "—"
export function formatRelativeTime(iso: string): string;        // "12 minutes ago"
export function confidenceLabel(score: number): { label: string; tone: "high" | "medium" | "low" };
```

`confidenceLabel` backs `ConfidenceIndicator` — see below for exact bands.
This is where the "meaning not decorative precision" rule (DESIGN.md §10,
`dashboard/CLAUDE.md` §9) actually gets implemented, once, so every consumer
gets it right.

---

## Components

### `InvestigationTrace.tsx` — THE HERO

**Purpose:** the vertical timeline of a single investigation's steps,
implementing F02. This is what a judge watches during the live demo — it is
the component that has to look alive.

**Feature ID:** F02 (primary), F03/F06 surfaced via nested `EvidenceCard`/
`SimilarIssueComparison` when a step is expanded.

```typescript
export interface InvestigationTraceProps {
  investigationId: string;
  initialSteps: StepRecord[];        // from REST, on mount
  live?: boolean;                    // subscribe to WS updates; false for a closed/historical investigation
  className?: string;
}
```

**Behavior:**

- On mount, render `initialSteps` from `GET /api/investigations/{id}`
  (REST — the source of truth per `dashboard/CLAUDE.md` §10).
- If `live`, also subscribe (via `useSocket`) to `step.started` /
  `step.completed` / `investigation.completed` events for this
  `investigation_id` and merge them into local state by `step_id` — new
  step appends, existing step updates in place (a `running` step receiving
  `step.completed` becomes `done`/`error` with a final `duration_ms`).
- **On reconnect, discard the WS-derived local merge and refetch via REST**,
  then resume live merging. This is the concrete implementation of
  `dashboard/CLAUDE.md` §10 — do not try to reconcile a partial WS gap by
  hand, just resync from the authoritative source.
- **Must replay correctly from REST on a hard page refresh** with no WS
  connection at all — a judge refreshing mid-demo must see the exact same
  trace, not a blank timeline. This is a hard acceptance criterion, not a
  nice-to-have.
- Steps render newest-at-bottom, in `seq` order, not arrival order (arrival
  order and `seq` order should usually match, but `seq` is authoritative if
  they ever diverge, e.g. after a resync).
- Each step shows status via **icon + text**, never color alone: `running`
  → animated `Search`/spinner + "Running", `done` → `BadgeCheck` (green) +
  "Done", `error` → an error-toned icon + "Error". Use the icon map in
  `dashboard/CLAUDE.md` §6 where a step's `name` maps to a semantic icon
  (e.g. a step named around evidence retrieval can use `History`).
- Expanding a step reveals its `evidence: Evidence[]` as a list of
  `EvidenceCard`, plus `input_summary`/`output_summary` as structured text —
  **never** raw model output that looks like chain-of-thought. If a step's
  `output_summary` ever contains something that reads like private
  reasoning rather than a structured summary, that's a backend contract bug
  — flag it, don't render it anyway.
- New steps arriving over WS animate in (slide/fade). **Respect
  `prefers-reduced-motion`**: swap the transition for an instant appearance,
  no exceptions — this is called out explicitly because it's the one
  component most tempted to over-animate.

**UI states (from the twelve, `dashboard/CLAUDE.md` §7):** initial loading
(skeleton timeline via `SkeletonState`), background refreshing (subtle,
non-blocking — don't unmount existing steps while refetching), empty result
(investigation exists but has zero steps yet — show "Waiting to start"),
partial data (a step with `evidence: []` or `null` `duration_ms` renders
fine, doesn't crash), agent/model failure (a step with `status: "error"`
renders distinctly, with the error reason from `output_summary`), RAG index
unavailable (a retrieval-type step in `error` state with that reason),
stale data (if `live` is true but `connectionState` from `useSocket` is
`reconnecting`/`offline`, show a small inline banner — "Reconnecting, trace
may be behind" — do not silently pretend it's live), awaiting approval (the
terminal state — `investigation.completed` received but the last logical
action needs a human; hand off to `ApprovalPanel`).

**Accessibility:** the timeline is a `<ol>`/`<ul>` (ordered, since `seq`
matters), each step a landmark-free list item with a heading for its title.
Expand/collapse is a real `<button>` with `aria-expanded`. Live-arriving
steps should be announced via a polite `aria-live` region (not assertive —
this fires frequently during a demo and shouldn't interrupt a screen reader
user constantly).

**Acceptance criteria:**

- [ ] Loads and renders from REST alone, WS fully disabled (`live={false}`)
- [ ] With `live`, a fake WS event for a new `step_id` appends without
      re-rendering/losing scroll position of existing steps
- [ ] A `step.completed` event for an existing `running` step updates it in
      place, not as a duplicate
- [ ] Hard refresh mid-investigation reproduces the exact same visual state
      from REST alone
- [ ] `prefers-reduced-motion: reduce` removes all transition/animation
- [ ] Status is legible with color removed (test by squinting / grayscale)

---

### `InvestigationStep.tsx`

**Purpose:** a single row/item within `InvestigationTrace`. Split out so the
timeline component stays about orchestration, not per-step rendering.

**Feature ID:** F02.

```typescript
export interface InvestigationStepProps {
  step: StepRecord;
  expanded: boolean;
  onToggleExpand: () => void;
}
```

**States:** running / done / error (from `step.status`), plus collapsed vs.
expanded. No independent loading state — it only ever renders a `StepRecord`
it's given.

**Accessibility:** icon has `aria-hidden`, status is also spelled out as
text next to it. The expand toggle is keyboard-operable and has an
`aria-label` along the lines of `"Expand step: {title}"` when collapsed.

**Acceptance criteria:**

- [ ] Renders all three statuses distinctly without relying on the reader
      inferring from color
- [ ] `duration_ms: null` (still running) shows a live-updating or
      placeholder duration, not `"nullms"`
- [ ] Expand/collapse is keyboard operable (Enter/Space) and reflected in
      `aria-expanded`

---

### `EvidenceCard.tsx`

**Purpose:** render one `Evidence` item — a citation backing a step's
output. This is what makes F03/F05 ("evidence before automation",
DESIGN.md §2) visible rather than asserted.

**Feature ID:** F03, F05.

```typescript
export interface EvidenceCardProps {
  evidence: Evidence;
  onOpenSource?: (evidence: Evidence) => void;   // e.g. open the GitHub issue/PR/file
}
```

**Behavior:** icon reflects `evidence.type` via the DESIGN.md §8 map
(`issue` → `CircleDot`, `pr` → `GitPullRequest`, `file` → a file icon,
`rule` → a rule/policy icon). `snippet` renders in the mono font
(`dashboard/CLAUDE.md` §5) since it's source text, not UI copy. `score`
feeds `ConfidenceIndicator`-style labeling if surfaced, or a plain
similarity label — never a raw float on its own in the primary UI.

**States:** the card itself is stateless/pure given an `Evidence`; the
parent (`InvestigationTrace`, or `InvestigationList` history) handles
loading/empty around a list of these.

**Accessibility:** the whole card (or its "open source" affordance) is a
real link/button with an accessible name including the ref, e.g. `"Open
issue #142 in a new tab"`.

**Acceptance criteria:**

- [ ] All four `evidence.type` values render a distinct, correctly-mapped icon
- [ ] `snippet` uses the mono font token, wraps instead of overflowing
- [ ] `onOpenSource` is optional and the card degrades to non-interactive
      display when omitted (e.g. inside a printed/exported view later)

---

### `SimilarIssueComparison.tsx`

**Purpose:** implements F06 — distinguish duplicate vs. regression vs.
related vs. known-solution vs. no-match, per DESIGN.md §7.4.

**Feature ID:** F06 (backed by F03 retrieval).

```typescript
export type IssueRelationship =
  | "duplicate"
  | "regression"
  | "related"
  | "known_solution"
  | "no_match";

export interface SimilarIssueComparisonItem {
  issueRef: string;             // e.g. "owner/repo#97"
  title: string;
  state: "open" | "closed";
  similarity: number;           // 0-1, raw score from Evidence
  component?: string;
  versionOrEnvironment?: string;
  reproductionOverlap?: "high" | "medium" | "low" | "unknown";
  resolutionStatus?: string;
  linkedFixRef?: string;        // PR or commit
  relationship: IssueRelationship;
}

export interface SimilarIssueComparisonProps {
  items: SimilarIssueComparisonItem[];
}
```

**Behavior:** one row/card per comparison item, all fields from DESIGN.md
§7.4 present when available. `relationship` renders as a labeled badge
(text + icon, e.g. `regression` might reuse a warning-toned icon) — never a
bare colored chip. `similarity` goes through the same "meaning not
precision" treatment as confidence (§9 of `dashboard/CLAUDE.md`) — reuse
`confidenceLabel` from `format.ts` rather than inventing a second banding
scheme.

**States:** empty (`items: []` — "No similar issues found", a real signal,
not a loading state), partial (some optional fields missing — render "—"),
loading handled by parent.

**Accessibility:** if rendered as a table, header cells are real `<th>`;
collapses to stacked cards at narrow width per `dashboard/CLAUDE.md` §8.

**Acceptance criteria:**

- [ ] All five `IssueRelationship` values map to a distinct label+icon pair
- [ ] Missing optional fields render a placeholder, not `undefined`/blank
- [ ] `linkedFixRef`, when present, is a working link to the PR/commit

---

### `ConfidenceIndicator.tsx`

**Purpose:** the single, reusable implementation of "confidence shown with
meaning, not decorative precision" (DESIGN.md §10). Every other component
that needs to show a confidence/similarity score uses this rather than
formatting a percentage inline.

**Feature ID:** F05.

```typescript
export type ConfidenceTone = "high" | "medium" | "low";

export interface ConfidenceIndicatorProps {
  score: number;                 // 0-1
  reason?: string;                // e.g. "strong semantic match and matching reproduction details"
  size?: "sm" | "md";
}
```

**Behavior — exact bands** (tune thresholds with backend/Person B, but the
shape is fixed):

- `score >= 0.75` → tone `high`, label **"High confidence"**
- `0.4 <= score < 0.75` → tone `medium`, label **"Medium confidence"**
- `score < 0.4` → tone `low`, label **"Low confidence"**

Rendered text is always `"{Label}{ — reason, if provided}"`, e.g.
`"High confidence — strong semantic match."` **Never** render the raw
`score` as a percentage in the primary label. If you want a precise number
for power users, put it in a `title`/tooltip attribute only, not the
visible text.

**States:** none beyond pure rendering — this is a leaf, presentational
component.

**Accessibility:** tone is conveyed by an icon + the text label, not color
alone (reuses the rule from `dashboard/CLAUDE.md` §8/§9). If truncated
visually, the full reason is still in the accessible name.

**Acceptance criteria:**

- [ ] No raw percentage anywhere in the rendered text
- [ ] Thresholds match `format.ts`'s `confidenceLabel` exactly — this
      component should just be `confidenceLabel` plus markup, not a second
      implementation of the banding logic
- [ ] Legible with color stripped

---

### `InvestigationList.tsx`

**Purpose:** the list/table of investigations (`GET /api/investigations`),
the entry point into `InvestigationTrace` detail views.

**Feature ID:** F02.

```typescript
export interface InvestigationListProps {
  investigations: InvestigationSummary[];
  selectedId?: string;
  onSelect: (id: string) => void;
  isRefreshing?: boolean;
}
```

**States:** all twelve as applicable — this is the first screen many demo
paths hit. Initial loading → `SkeletonState` (D's component). Empty → "No
investigations yet" via `EmptyState` (D's component) with a hint text tied
to F01 (an event needs to arrive, or run a manual trigger). Background
refreshing → keep existing rows, show a subtle refresh affordance, don't
flash the whole list to a skeleton.

**Accessibility:** rows are keyboard-navigable (up/down + Enter to select),
selected row has a visible focus/selected state that isn't color-only
(e.g. also a border/checkmark).

**Acceptance criteria:**

- [ ] Keyboard up/down + Enter selects an investigation, matching
      `onSelect`
- [ ] Empty and loading states both render via the shared D primitives, not
      bespoke markup
- [ ] Selected row is distinguishable without color (border/icon)

---

### `ApprovalPanel.tsx`

**Purpose:** the approve/reject/correct controls for F05 (explainability
and maintainer feedback) and the terminal gate for any consequential action
per DESIGN.md §12's autonomy policy table. This is where "awaiting
approval" (one of the twelve states) becomes an actual interactive control,
not just a label.

**Feature ID:** F05.

```typescript
export type FeedbackDecision = "approve" | "reject" | "correct";

export interface ApprovalPanelProps {
  investigationId: string;
  proposedAction: string;            // human-readable summary of what will happen if approved
  isPublicAction: boolean;           // true if this would post/label publicly — drives extra confirmation copy
  onSubmit: (decision: FeedbackDecision, note?: string) => Promise<void>;
  disabled?: boolean;                 // e.g. already decided
}
```

**Behavior:** three clearly labeled actions (not icon-only — this is a
consequential control). `"correct"` opens an inline note field (a
correction without free text is not useful feedback). When
`isPublicAction` is true, the copy explicitly says this will be visible
publicly on GitHub — per DESIGN.md §12, publishing a public comment or a
security finding always requires this explicit approval step; the panel
must not let that distinction get lost in generic "Approve" copy.

**States:** idle (awaiting decision), submitting (disable buttons, show
progress — do not allow a double-submit), success (decision recorded,
panel becomes read-only showing what was chosen and by whom), error
(submission failed — show the error, keep the panel interactive so the
user can retry, per the twelve-states "agent/model failure" /
generic-failure case).

**Accessibility:** this is graded explicitly under "dialogs trap focus" if
rendered as a dialog, or under normal focus-order rules if inline. Buttons
have clear accessible names ("Approve", "Reject", "Submit correction"), not
just icons. If a confirmation dialog is used for the public-action case, it
must trap and return focus per `dashboard/CLAUDE.md` §8.

**Acceptance criteria:**

- [ ] Cannot submit twice concurrently (buttons disabled while `onSubmit`'s
      promise is pending)
- [ ] `isPublicAction: true` renders visibly different confirmation copy,
      not just a different button color
- [ ] `"correct"` requires and submits a non-empty note
- [ ] A failed submission leaves the panel usable for retry, with the error
      visible as text

---

## Task breakdown

| Task | Files | Branch | Depends on | Feature ID |
|---|---|---|---|---|
| Scaffold + tokens (if not already done by D) | `dashboard/` root config | `feat/c-scaffold` | — | — |
| Types mirror | `src/lib/types.ts` | `feat/c-types` | `api/schemas.py` frozen (root §7) | all |
| API client | `src/lib/api.ts` | `feat/c-api-client` | `feat/c-types` | F01–F06 |
| Format helpers | `src/lib/format.ts` | `feat/c-format` | `feat/c-types` | F05 |
| WebSocket hook | `src/lib/useSocket.ts` | `feat/c-usesocket` | `feat/c-types` | F02 |
| ConfidenceIndicator | `src/components/ConfidenceIndicator.tsx` | `feat/c-confidence-indicator` | `feat/c-format` | F05 |
| EvidenceCard | `src/components/EvidenceCard.tsx` | `feat/c-evidence-card` | `feat/c-types` | F03, F05 |
| InvestigationStep | `src/components/InvestigationStep.tsx` | `feat/c-investigation-step` | `feat/c-evidence-card`, `feat/c-format` | F02 |
| InvestigationTrace | `src/components/InvestigationTrace.tsx` | `feat/c-investigation-trace` | `feat/c-investigation-step`, `feat/c-usesocket` | F02 |
| SimilarIssueComparison | `src/components/SimilarIssueComparison.tsx` | `feat/c-similar-issue` | `feat/c-confidence-indicator` | F06 |
| InvestigationList | `src/components/InvestigationList.tsx` | `feat/c-investigation-list` | `feat/c-api-client`, D's `EmptyState`/`SkeletonState` | F02 |
| ApprovalPanel | `src/components/ApprovalPanel.tsx` | `feat/c-approval-panel` | `feat/c-api-client` | F05 |

---

## Definition of done

See `dashboard/CLAUDE.md` §13 for the full shared checklist. Additionally,
for this workstream specifically:

- [ ] `types.ts` has zero drift from the current `api/schemas.py`
- [ ] `InvestigationTrace` survives a hard refresh with identical visual
      state (the single most demo-critical acceptance criterion in this
      file)
- [ ] No component in this file ever renders anything resembling hidden
      chain-of-thought — only the structured `StepRecord`/`Evidence` fields
- [ ] Every confidence/similarity number in the UI goes through
      `ConfidenceIndicator`/`confidenceLabel`, never a bare `%` string
