# Doombot VS Code Extension

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

## Run

```bash
npm install
npm run compile
# then press F5 in VS Code to launch the Extension Development Host
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
