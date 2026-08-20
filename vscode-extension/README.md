# Stream D — Shell & Extension

**Owner: Person D.** The VS Code extension (F14), plus the dashboard's app
shell, overview, escalations, and health screens.

## Read before working here

| File | What |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | **Agent operating manual — read first, always** |
| [CLAUDE.md](CLAUDE.md) | **The contract for this folder** |
| [../dashboard/FRONTEND-D.md](../dashboard/FRONTEND-D.md) | Person D's dashboard components |
| [../dashboard/CLAUDE.md](../dashboard/CLAUDE.md) | Shared frontend rules — tokens, UI states, a11y, WS strategy |

## You own

```
vscode-extension/                    all of it
dashboard/src/App.tsx                routing and shell wiring
dashboard/src/components/Repo*       RepositorySelector
dashboard/src/components/Escalation* EscalationTable, EscalationPreview
dashboard/src/components/Activity*   AgentActivityFeed
```

`dashboard/src/components/` is **shared with Stream C** — C owns `Chain*`,
`Evidence*`, and `Investigation*`. Same folder, different files: check
ownership before editing a component you did not write.

**Priority:** the extension is P2 and **first on the cut list**. If the
dashboard needs you, stash this and switch (root `CLAUDE.md` §5). Never let
extension work block a `FRONTEND-D.md` PR.

---

A **companion** to the dashboard, not a second product (F14, P2 stretch).

Everything non-trivial delegates to the web dashboard. `docs/DESIGN.md` §4
treats "makes the VS Code extension a separate product with different logic"
as a spec conflict, so there is no duplicated React here and no second design
system — native chrome uses the editor's own theme colours.

## What it does

| Piece | Implementation |
|---|---|
| Status bar | Health score + open escalation count, polled from REST |
| Escalations tree | `GET /api/escalations`, severity in the label text |
| Recent investigations tree | `GET /api/investigations`, capped at 15 |
| Critical toast | Fires when the critical count rises between polls |
| `Doombot: Open Dashboard` | Webview panel framing the running dashboard |
| `Doombot: Trigger Repository Scan` | `POST /api/investigations` — same endpoint the dashboard uses |
| `Doombot: Refresh Escalations` | Immediate re-poll |

Clicking any tree item opens the dashboard at that investigation. Full
evidence exploration lives there by design.

## Settings

| Setting | Default |
|---|---|
| `doombot.apiBaseUrl` | `http://localhost:8000` |
| `doombot.dashboardUrl` | `http://localhost:5173` |
| `doombot.repository` | `""` — set to `owner/repo` for a health score |
| `doombot.pollSeconds` | `15` |

## Contract traps — all four of these were real bugs

`src/api.ts` hand-mirrors `api/schemas.py`. There is no codegen, so a drifted
mirror type-checks perfectly and fails only at runtime. Every item below
compiled clean and still misbehaved:

| Trap | What went wrong |
|---|---|
| **Status values** | `statusIcon` matched `'completed'`, but the API only ever emits `running \| done \| error`. Every finished investigation fell through to the spinner and spun forever, so the tree claimed activity against an idle backend. |
| **Toast baseline** | `lastCriticalCount` started at `0`, so the first poll treated the whole existing backlog as new and fired a false "N new critical escalations" popup on every VS Code launch. Establishing a baseline is not an increase. |
| **Config never re-read** | `pollSeconds()` was read once when the timer was created, so changing `doombot.pollSeconds` did nothing until a window reload. Now re-arms on `onDidChangeConfiguration`. |
| **Narrower than the contract** | `InvestigationSummary` omitted `completed_at` and typed `status`/`breakdown` loosely. Now mirrors `schemas.py` exactly, with `status` as a literal union so a bad comparison is a compile error rather than a silent spinner. |

The lesson generalises: **when you touch `src/api.ts`, diff it against
`api/schemas.py` by eye.** A wrong string literal in a `switch` is invisible
to `tsc` — it just picks the `default` branch forever.

> **Two different "health" endpoints.** `GET /api/health` is a liveness probe
> returning `{"status":"ok"}` with no score in it. The number the status bar
> shows comes from `GET /api/repos/{owner}/{repo}/health`, which needs
> `doombot.repository` set to `owner/repo` — otherwise the status bar shows
> `--`, which is correct behavior, not a bug.

---

## Run

```bash
npm install
npm run compile
# then press F5 in VS Code to launch the Extension Development Host
```

Verify with `npx tsc -p ./ --noEmit` — but note that a clean type-check proves
very little here, for exactly the reasons in the table above. Check the trees
against live data too:

```bash
curl http://localhost:8000/api/escalations
curl http://localhost:8000/api/investigations
```

The API and dashboard should be running, but the extension does not require
them: both trees render an explicit "Backend unreachable" node instead of an
empty panel.

## Deliberately not built

Diagnostics providers, CodeLens, a second design system, duplicated React,
and any native re-implementation of the investigation trace, escalation
table, or health cards. Per `CLAUDE.md`, the answer to "should this be a
VS Code-native screen?" is almost always "open the dashboard webview".

This is P2 and first on the cut list — it must never delay the dashboard.

---

## Stretch features

`Doombot: Open Issue Graph` opens the dashboard's `/graph` route in the
webview (F15).

Deliberately *not* a native VS Code graph. `react-force-graph` needs a canvas,
and `docs/DESIGN.md` §4 treats reimplementing dashboard UI natively as a spec
conflict — so this follows the same rule as every other rich view here: open
the dashboard.

F16 (auto-resolution) has no extension surface yet. When a resolution is
posted it will appear in the escalations tree like any other agent action.
