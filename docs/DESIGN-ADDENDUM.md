# Design Addendum — Implementation Specifics

**Companion to `docs/DESIGN.md`. That file stays the source of truth for scope,
principles, and screens. This file fills the gaps an implementer hits at 2am.**

`DESIGN.md` is strong on *what* and *why*. It is silent on the numbers you need
the moment you write a component: type scale, z-index, motion durations, grid
breakpoints, elevation, and the exact severity rules. Four people building in
parallel will each invent their own answers, and the UI will look like four
products. This file makes those decisions once.

**Precedence:** if this file and `DESIGN.md` conflict, `DESIGN.md` wins on scope
and principle; this file wins on numeric implementation detail. Anything here that
contradicts `DESIGN.md` is a bug — report it.

---

## 1. Contrast audit — verified, not assumed

Every token pair in `DESIGN.md` §8 was computed against WCAG 2.1. Results:

| Foreground | on `--background` | `--surface-1` | `--surface-2` | `--surface-3` |
|---|---:|---:|---:|---:|
| `--text-primary` | 18.07 | 17.18 | 16.54 | 15.03 |
| `--text-secondary` | 10.81 | 10.28 | 9.89 | 8.99 |
| `--text-muted` | 6.35 | 6.04 | 5.81 | 5.28 |
| `--accent` | 8.73 | 8.30 | 7.99 | 7.26 |
| `--accent-bright` | 11.41 | 10.85 | 10.44 | 9.49 |
| `--critical` | 5.42 | 5.15 | 4.96 | **4.50** |
| `--high` | 7.39 | 7.03 | 6.76 | 6.14 |
| `--warning` | 9.26 | 8.80 | 8.47 | 7.70 |
| `--information` | 9.28 | 8.83 | 8.49 | 7.72 |
| `--neutral` | 7.76 | 7.38 | 7.10 | 6.45 |

**The palette passes AA (4.5:1) for normal text everywhere.** Good — that claim in
`DESIGN.md` §11 is real, not aspirational.

**One edge:** `--critical` on `--surface-3` is **4.50** — passing by 0.00. Any
darkening of that surface breaks it. **Rule: never place `--critical` text on
`--surface-3`.** Critical badges use `--surface-1` or `--surface-2` backgrounds.

**Non-text tokens** are correctly below text thresholds and must never carry text:

| Token | Ratio on `--background` | Use |
|---|---:|---|
| `--border` `#24332a` | 1.50 | Hairlines only |
| `--accent-muted` `#163d25` | 1.64 | Fill behind `--accent-bright` text only |

---

## 2. Severity color ordering — a real defect

`DESIGN.md` §8 assigns `--critical: #f43f5e` and `--high: #fb7185`. Measured
relative luminance:

```
critical  #f43f5e   0.2360
high      #fb7185   0.3401   ← brighter
warning   #f59e0b   0.4389   ← brighter still
```

**On a dark interface, brighter reads as more urgent.** As specified, `high` is
visually louder than `critical`, and `warning` louder than both. The severity
hierarchy inverts exactly where it matters most — the escalation queue.

**Fix without changing the palette** (the tokens are fine; their *application* is
the problem). Encode severity with three reinforcing signals, not hue alone:

| Severity | Text | Fill | Left rule | Icon | Weight |
|---|---|---|---|---|---|
| `critical` | `--critical` | `--critical` @ 12% | 3px solid `--critical` | `TriangleAlert` | 600 |
| `high` | `--high` | `--high` @ 10% | 2px solid `--high` | `TriangleAlert` | 500 |
| `warning` | `--warning` | none | 2px solid `--warning` | `AlertCircle` | 500 |
| `info` | `--information` | none | 1px solid `--information` | `Info` | 400 |
| `resolved` | `--text-muted` | none | 1px solid `--border` | `BadgeCheck` | 400 |

Fill weight, rule thickness, and font weight all descend with severity. That
ordering survives the luminance inversion, and it satisfies `DESIGN.md` §8's rule
that color is never the only signal.

**Always render the severity word.** `[CRITICAL]` in text, per the §7.2 row format.

---

## 3. Type scale

`DESIGN.md` §8 sets a 14px floor and names the families. It does not give a scale.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-display` | 32 / 40 | 600 | Health score only |
| `text-h1` | 24 / 32 | 600 | Page title |
| `text-h2` | 18 / 28 | 600 | Section heading |
| `text-h3` | 16 / 24 | 600 | Card title |
| `text-body` | 14 / 20 | 400 | **Default** |
| `text-sm` | 13 / 18 | 400 | Secondary metadata |
| `text-mono` | 13 / 20 | 400 | Code, diffs, evidence snippets |
| `text-label` | 12 / 16 | 500 | Badges, table headers, overline |

**12px is the floor, and only for badges and table headers** — never body copy.
`DESIGN.md`'s "minimum 14px" applies to reading text; a `[CRITICAL]` chip is a
label, not prose.

**Numbers in tables and metrics use `tabular-nums`.** Without it, digits jitter as
values update over the WebSocket — visible and cheap to avoid.

```css
.metric, td.numeric { font-variant-numeric: tabular-nums; }
```

---

## 4. Elevation

`DESIGN.md` §8 says "one border and shadow system" without defining it. On a near-
black background, shadows barely register — **elevation comes from surface color,
with shadow as reinforcement.**

| Level | Surface | Border | Shadow | Use |
|---|---|---|---|---|
| 0 | `--background` | none | none | Page |
| 1 | `--surface-1` | 1px `--border` | none | Cards, panels |
| 2 | `--surface-2` | 1px `--border` | `0 1px 2px rgb(0 0 0 / 0.4)` | Hover, dropdowns |
| 3 | `--surface-3` | 1px `--border` | `0 4px 12px rgb(0 0 0 / 0.5)` | Modals, popovers |

Never stack two level-1 surfaces — the boundary vanishes. Nest 1 inside 0, or 2
inside 1.

---

## 5. Z-index

Unmanaged z-index is a guaranteed 3am bug when four people build overlays
independently.

```css
--z-base:     0;
--z-sticky:   10;   /* sticky table headers */
--z-dropdown: 20;   /* selects, comboboxes */
--z-overlay:  30;   /* modal scrim */
--z-modal:    40;   /* dialogs */
--z-popover:  50;   /* tooltips */
--z-toast:    60;   /* notifications — always on top */
```

**Never write a raw z-index.** If you need a layer that isn't here, it belongs in
this table first.

---

## 6. Motion

`DESIGN.md` §8 asks for "minimal decorative animation" and §11 requires reduced-
motion support. The numbers:

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--motion-instant` | 100ms | `ease-out` | Hover, focus |
| `--motion-fast` | 150ms | `ease-out` | Dropdowns, tooltips |
| `--motion-base` | 200ms | `cubic-bezier(0.2,0,0,1)` | Panels, step reveal |
| `--motion-slow` | 300ms | `cubic-bezier(0.2,0,0,1)` | Modals, route change |

**Animate only `transform` and `opacity`.** Animating `height`, `width`, or `top`
forces layout on every frame; with steps streaming in over a WebSocket, that
stutters visibly.

### Reduced motion — non-negotiable

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**The trace must still be readable with motion off.** Steps appear instantly rather
than sliding in; the content and ordering are identical. Never encode meaning in
the animation itself — a user with reduced motion must lose nothing.

---

## 7. Layout and breakpoints

`DESIGN.md` §11 names desktop primary and tablet usable. Concretely:

| Breakpoint | Width | Behavior |
|---|---|---|
| `sm` | < 768px | Not supported for MVP; do not spend time here |
| `md` | 768–1023px | Sidebar collapses to icons; split views stack |
| `lg` | 1024–1439px | Sidebar expanded; split views side by side |
| `xl` | ≥ 1440px | Content max-width 1440px, centered |

```
Sidebar expanded    240px
Sidebar collapsed    56px
Split view          40% queue / 60% preview, min preview 480px
Content max-width  1440px
Page padding        24px (lg+), 16px (md)
```

**Demo on `lg` or `xl`.** Build there first; make `md` merely functional.

---

## 8. The investigation trace — visual spec

This is the hero (F02). `DESIGN.md` §7.3 defines the *content*; here is the *form*.

```
┌──────────────────────────────────────────────────────┐
│  ●───  Fetched GitHub issue #142          Done  120ms│
│  │                                                    │
│  ●───  Searched 386 historical issues     Done  840ms│
│  │     ├ #412  0.91  "Login fails after…"            │
│  │     └ #388  0.72  "Auth token expires…"           │
│  │                                                    │
│  ◐───  Comparing symptoms…             Running       │
│  │                                                    │
│  ○───  Assess severity                 Pending       │
└──────────────────────────────────────────────────────┘
```

| Status | Marker | Color | Text | Motion |
|---|---|---|---|---|
| `done` | `●` filled | `--accent` | "Done" | none |
| `running` | `◐` spinner | `--accent-bright` | "Running" | 1s rotate, honors reduced-motion |
| `error` | `✕` | `--critical` | "Failed" | none |
| `skipped` | `○` hollow | `--text-muted` | "Skipped" | none |
| `pending` | `○` hollow | `--border` | "Pending" | none |

**Rules:**

- The connector rail is 1px `--border`; the segment above a completed step is
  `--accent`. Progress reads at a glance without counting.
- `duration_ms` is right-aligned, `--text-muted`, `tabular-nums`, `text-sm`.
  Under 1000ms show `840ms`; at or above, show `1.2s`.
- New steps animate **opacity 0→1 and translateY(4px→0)** over `--motion-base`.
  Nothing else. No slide-in from the side, no bounce.
- **Never auto-scroll away from a step the user is reading.** Auto-scroll only when
  already within 100px of the bottom — the standard chat-log rule.
- Evidence nests one level under its step, `text-mono`, `text-sm`.
- A `running` step needs `aria-live="polite"`; without it a screen reader announces
  nothing as the investigation proceeds.

---

## 9. Confidence display

`DESIGN.md` §10 bans decorative precision and requires meaning. The mapping:

| Range | Label | Color | Meaning shown alongside |
|---|---|---|---|
| ≥ 0.90 | High confidence | `--accent` | "strong semantic match" |
| 0.75–0.89 | Moderate confidence | `--information` | "partial match" |
| 0.60–0.74 | Low confidence | `--warning` | "weak signal — review carefully" |
| < 0.60 | Insufficient | `--text-muted` | "below escalation threshold" |

Render as: **`High confidence`** — strong semantic match and matching reproduction
details.

**Never render a raw percentage as the primary signal.** If a number is shown at
all, it is secondary, rounded to whole percent, and never more precise than that.

The one exception is **semantic similarity in the comparison view**, where `0.91`
is a genuine measurement the maintainer is evaluating — not a claim about the
agent's certainty. Show it to two decimals, in `text-mono`.

---

## 10. Empty, error, and loading states

`DESIGN.md` §10 lists twelve required states. The three primitives Person D builds
first — C depends on them:

**Empty** — icon (`--text-muted`, 32px), one-line title (`text-h3`), one sentence of
explanation (`text-body`, `--text-secondary`), optional single action. Never a bare
"No data."

**Error** — `AlertCircle` in `--critical`, what failed in plain language, and a
retry button. **Never surface a raw exception or stack trace** — §12 forbids
leaking internals, and a traceback can carry a token.

**Skeleton** — `--surface-2` blocks at the real content's dimensions, 1.5s pulse
between 100% and 60% opacity. Must match the final layout's shape or the page
jumps on load. Honors reduced motion: static block, no pulse.

**Rate limited** (GitHub 403) is its own state, not a generic error: show when
access resets, and keep displaying cached data with a "stale" marker.

---

## 11. Focus and keyboard

`DESIGN.md` §11 requires visible focus and full keyboard access. Specifics:

```css
:focus-visible {
  outline: 2px solid var(--accent-bright);
  outline-offset: 2px;
  border-radius: 4px;
}
```

Use `:focus-visible`, not `:focus` — the latter rings on mouse click and looks
broken. **Never `outline: none`** without an equivalent replacement.

Escalation queue bindings (§7.2 requires next/previous):

| Key | Action |
|---|---|
| `j` / `↓` | Next escalation |
| `k` / `↑` | Previous |
| `Enter` | Open investigation |
| `a` | Approve (focuses the confirm, never fires it) |
| `r` | Reject |
| `Esc` | Close preview / dismiss dialog |
| `/` | Focus search |
| `?` | Keyboard help |

**A destructive or outward-facing action never fires from a single keystroke.**
`a` moves focus to the confirm control; the human presses it.

---

## 12. Writing

The UI's voice, unified. Four people writing microcopy independently is how a
product starts sounding like four products.

- **Present tense, active voice.** "Found 3 similar issues" — not "3 similar issues
  were found."
- **The agent is "Doombot" or "the agent," never "I" or "we."** It is a tool.
- **Recommend, don't assert.** "Recommend escalating — matches #412 (0.91)" rather
  than "This is a duplicate."
- **Name numbers.** "Searched 386 issues" beats "Searched history."
- **Errors say what to do.** "GitHub rate limit reached. Resets in 12 minutes."
- **Sentence case for headings and buttons.** Not Title Case, not ALL CAPS —
  except severity chips, which are `[CRITICAL]` per §7.2.
- **No exclamation marks. No emoji in product UI.**

Terminology — pick one and never alternate:

| Use | Not |
|---|---|
| investigation | analysis, scan, run |
| escalation | alert, notification |
| evidence | sources, references, citations |
| trace | chain, log, timeline |
| duplicate / regression / related | similar |
| maintainer | user, admin |

---

## 13. Security in the UI

`DESIGN.md` §12 sets the policy. What it means at the component level:

- **A suspected security finding renders with a private badge** (`Lock` icon,
  "Private") until a human approves disclosure. There is no default-public path.
- **The approval dialog for any public action shows the exact text** that will be
  posted to GitHub, verbatim, before the human confirms.
- **Never render a raw token, header, or credential** — not in evidence snippets,
  not in error states, not in a trace step. Redact at the API boundary, and treat
  the UI as a second line of defense rather than the first.
- **Evidence snippets are truncated to 500 characters** with a link to the source.
  A full issue body pasted into a card is both unreadable and a leak surface.
- **The trace shows tool activity, not reasoning.** "Searched 386 historical
  issues" is allowed; the model's deliberation is not. This is `DESIGN.md` §4's
  hard line — violating it is a spec conflict, not a style choice.

---

## 14. Definition of done — additions

Extends `DESIGN.md` §14. A component is complete only when all of these also hold:

- [ ] Uses only `DESIGN.md` §8 tokens — no raw hex, no default Tailwind palette
- [ ] Type from §3 of this file; no arbitrary `text-[15px]`
- [ ] z-index from §5; no raw value
- [ ] Animates only `transform`/`opacity`; verified under `prefers-reduced-motion`
- [ ] `:focus-visible` ring present and visible on every interactive element
- [ ] Severity uses color **plus** icon **plus** text
- [ ] Empty, error, and loading states implemented — not just the happy path
- [ ] No raw exception, token, or credential reachable in any state
- [ ] Numeric columns use `tabular-nums`
- [ ] Keyboard-operable end to end; tab order follows visual order
- [ ] Readable at `md` (768px), polished at `lg` (1024px)
- [ ] Microcopy follows §12 terminology
