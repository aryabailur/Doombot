# Doombot VS Code Extension

A **companion** surface, not a second product (F14, P2 stretch).

See [CLAUDE.md](CLAUDE.md) for the full spec — scope, `package.json` contributes,
the webview CSP requirement, and the do-not-build list.

## Scope

Status-bar health score and escalation count · escalation tree view · recent
investigations · toast on new critical escalation · command to open the dashboard.

Anything richer — analytics, policy editing, full evidence exploration — opens the
web dashboard instead.

## Quick start

```bash
npm install && npm run compile
# then press F5 in VS Code to launch the Extension Development Host
```
