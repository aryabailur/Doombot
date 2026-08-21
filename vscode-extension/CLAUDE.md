# Doombot VS Code Extension

**Owner: Person D.** Read `dashboard/CLAUDE.md` first — the extension reuses
the dashboard's running instance rather than reimplementing any UI, so the
tokens/conventions there are relevant context even though this folder has no
Tailwind/React of its own.

**Feature ID: F14. Priority: P2, STRETCH.** Per root `CLAUDE.md` §5 and
DESIGN.md §3: P2 features "must not delay the primary dashboard or break the
core investigation flow." If you are behind on `FRONTEND-D.md`'s work, this
file is what you cut, not the other way around.

> The current `vscode-extension/README.md` describes a single-iframe-only
> extension with no tree views. That was the original minimal plan; this
> document supersedes it with the fuller — but still small — scope below,
> which matches DESIGN.md §7.9's minimum useful scope. Update the README
> when you start implementation so it stops contradicting this file.

---

## Scope verdict (per DESIGN.md §4's scope-checking protocol)

- **Verdict:** Stretch (P2), in scope with constraints.
- **Feature ID:** F14.
- **Why it belongs:** DESIGN.md §7.9 explicitly specifies a companion VS
  Code experience as part of the approved 14-feature scope.
- **Constraint:** DESIGN.md §4 lists "makes the VS Code extension a separate
  product with different logic" as a **conflicts-with-specification**
  verdict — the most severe category. Concretely: no second design system,
  no duplicated React app, no reimplemented investigation logic. Everything
  non-trivial delegates to the web dashboard already running at
  `localhost:5173`.

---

## What "companion, not a second product" means concretely

DESIGN.md §7.9's minimum useful scope:

- Status-bar health and escalation count
- Escalation tree view
- Recent investigation list
- Toast notification for a new critical escalation
- Commands to open the dashboard or trigger a permitted scan

And explicitly: "Complex analytics, policy editing, and full evidence
exploration should open the web dashboard" instead of being rebuilt here.

### Do NOT build

- Diagnostics providers
- CodeLens
- A second design system (no custom VS Code UI Toolkit theme system parallel
  to the dashboard's tokens)
- Duplicated React — do not bundle a second copy of any dashboard component
- Full evidence exploration, policy editing, or analytics screens inside
  native VS Code UI — these open the dashboard webview instead

If a feature request for this extension would require re-implementing
something `InvestigationTrace`, `EscalationTable`, or `HealthScoreCard`
already do (see `dashboard/FRONTEND-C.md`, `dashboard/FRONTEND-D.md`), the
correct answer is almost always "open the dashboard webview to that route,"
not "build a VS Code-native version."

---

## The pragmatic build

One extension, three pieces:

1. **A single `WebviewPanel` that iframes `http://localhost:5173`** — this
   is how you get the *entire* dashboard UI (Overview, Escalations,
   Investigations, Health) inside VS Code for a small amount of code. This
   is the "full UI in VS Code for minimal code" move.
2. **A real `StatusBarItem`** — health score + pending escalation count,
   fed by a lightweight poll of the REST API. This is native VS Code chrome,
   not a webview, so it's cheap and always visible.
3. **One `TreeDataProvider`** — the escalation tree view and recent
   investigation list, fed directly by REST responses (`GET
   /api/escalations`, `GET /api/investigations`). This is genuinely native,
   which is what makes the extension read as a real extension to a judge
   rather than "a browser tab pretending to be one."

**The tradeoff, stated plainly:** the webview gives you 90% of the visible
feature surface for near-zero extra frontend work, because it's the same
dashboard C and D already built. The status bar item and tree view are the
~10% that's worth hand-building natively, because that's the part a judge
can only experience as "a VS Code extension" — a status bar health number
and a sidebar tree of escalations are things an iframe cannot give you, and
they're what make this look like a real extension rather than a bookmark.

---

## `package.json` contributes

```json
{
  "name": "doombot",
  "displayName": "Doombot",
  "engines": { "vscode": "^1.85.0" },
  "activationEvents": [
    "onStartupFinished"
  ],
  "contributes": {
    "commands": [
      { "command": "doombot.openDashboard", "title": "Doombot: Open Dashboard" },
      { "command": "doombot.triggerScan", "title": "Doombot: Trigger Repository Scan" },
      { "command": "doombot.refreshEscalations", "title": "Doombot: Refresh Escalations" }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "doombot",
          "title": "Doombot",
          "icon": "media/icon.svg"
        }
      ]
    },
    "views": {
      "doombot": [
        { "id": "doombot.escalations", "name": "Escalations" },
        { "id": "doombot.investigations", "name": "Recent Investigations" }
      ]
    }
  }
}
```

Notes:

- `onStartupFinished` rather than `*` — don't slow down VS Code's own
  startup for a hackathon side project (`*` is a documented anti-pattern in
  the VS Code extension guidelines).
- `doombot.triggerScan` maps to F01's "trigger a permitted scan" — it should
  call the same investigation-creation endpoint the dashboard uses
  (`POST /api/investigations`), nothing extension-specific.
- Two tree views under one container: escalations and recent investigations,
  matching DESIGN.md §7.9's two list requirements exactly — do not add a
  third view (e.g. a health tree) since health is a single number, better
  served by the status bar.

---

## `src/extension.ts` — activate/deactivate

```typescript
// src/extension.ts (shape)

import * as vscode from "vscode";

let statusBarItem: vscode.StatusBarItem;
let escalationsProvider: EscalationsTreeProvider;
let investigationsProvider: InvestigationsTreeProvider;
let pollInterval: ReturnType<typeof setInterval>;

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "doombot.openDashboard";
  context.subscriptions.push(statusBarItem);

  escalationsProvider = new EscalationsTreeProvider(apiBaseUrl());
  investigationsProvider = new InvestigationsTreeProvider(apiBaseUrl());
  vscode.window.registerTreeDataProvider("doombot.escalations", escalationsProvider);
  vscode.window.registerTreeDataProvider("doombot.investigations", investigationsProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand("doombot.openDashboard", openDashboardWebview),
    vscode.commands.registerCommand("doombot.triggerScan", triggerScan),
    vscode.commands.registerCommand("doombot.refreshEscalations", () => escalationsProvider.refresh())
  );

  pollInterval = setInterval(() => refreshAll(), 15000);
  refreshAll();
}

export function deactivate(): void {
  clearInterval(pollInterval);
}

function refreshAll(): void {
  // fetch health + escalation count -> update statusBarItem.text
  // diff previous critical-escalation count vs new -> vscode.window.showWarningMessage(...) toast on increase
  // escalationsProvider.refresh(); investigationsProvider.refresh();
}
```

**Behavior notes:**

- Poll on a plain `setInterval` (15–30s) against REST — do not open a second
  WebSocket client here. A polling native tree + a live webview underneath
  it is enough; two independent realtime channels in one extension is
  needless complexity for a stretch feature.
- The "toast on new critical escalation" requirement is implemented by
  diffing the previous poll's critical count against the new one inside
  `refreshAll` and calling `vscode.window.showWarningMessage` (or
  `showErrorMessage` for critical) when it increases. Keep this dumb and
  simple — no dedup/cooldown logic beyond "did the count go up."

---

## Tree provider

```typescript
// src/escalationsTreeProvider.ts (shape)

import * as vscode from "vscode";

export class EscalationsTreeProvider implements vscode.TreeDataProvider<EscalationTreeItem> {
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private apiBaseUrl: string) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: EscalationTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<EscalationTreeItem[]> {
    // GET `${this.apiBaseUrl}/api/escalations`, map each Escalation to an EscalationTreeItem
    return [];
  }
}

class EscalationTreeItem extends vscode.TreeItem {
  constructor(public readonly severity: string, label: string, public readonly escalationId: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(iconForSeverity(severity));
    this.command = {
      command: "doombot.openDashboard",
      title: "Open in Dashboard",
      arguments: [`/escalations?focus=${escalationId}`],
    };
  }
}
```

Selecting a tree item opens the webview scrolled/deep-linked to that
escalation in the dashboard rather than rendering escalation detail natively
— this is the "companion, not a second product" rule applied at the code
level. Reuse `vscode.ThemeIcon` names that map conceptually to the Lucide
icons already used in the dashboard (`dashboard/CLAUDE.md` §6) so severity
reads consistently across both surfaces — exact 1:1 icon parity between
Lucide and VS Code's codicon set isn't required, just don't contradict it
(e.g. don't use a "success" green checkmark for a critical escalation).

`InvestigationsTreeProvider` mirrors this shape against
`GET /api/investigations`, showing the most recent N summaries.

---

## Webview: iframing the dashboard

```typescript
// openDashboardWebview (shape)

function openDashboardWebview(deepLink?: string): void {
  const panel = vscode.window.createWebviewPanel(
    "doombotDashboard",
    "Doombot",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const url = `http://localhost:5173${deepLink ?? "/overview"}`;
  panel.webview.html = getWebviewHtml(url);
}
```

### Content-Security-Policy requirement

Webviews are CSP-locked by default and **do not allow arbitrary iframes
unless the CSP explicitly permits the frame source.** The webview's HTML
must include a `frame-src` (and typically `default-src`) directive that
allows `http://localhost:5173` specifically — a wildcard or missing CSP
either breaks the iframe or trips VS Code's webview security warnings. Use
a nonce for any inline `<script>` per the standard VS Code webview security
pattern; the iframe itself is the only piece of "content" being loaded:

```html
<!-- inside getWebviewHtml, shape only -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; frame-src http://localhost:5173; style-src 'unsafe-inline';">
<iframe src="{{url}}" style="width:100%; height:100vh; border:0;"></iframe>
```

**Trap:** if the dashboard's own dev/preview server ever changes port or is
proxied differently, this CSP breaks silently (blank webview, no visible
error beyond VS Code's dev console). Keep the port sourced from one place —
an extension setting (`doombot.dashboardUrl`, default
`http://localhost:5173`) rather than hardcoded in two files.

---

## "Cut this first if time runs out"

This entire folder is P2/stretch (root `CLAUDE.md` §5, DESIGN.md §3: "F11,
F12, and F14 are useful bonuses. They must not delay the primary dashboard
or break the core investigation flow."). If you are behind schedule on
`dashboard/FRONTEND-D.md`, in this order:

1. Cut the extension entirely first — the web dashboard alone satisfies F13
   (P0) and the demo story in DESIGN.md §5 doesn't require it.
2. If there's time for a reduced version, cut the tree views and toast
   before the webview+status-bar pairing — the webview is nearly free
   (reuses the dashboard) and the status bar is a handful of lines; the tree
   providers are the most code for the least demo impact.
3. Never let extension work block a `dashboard/FRONTEND-D.md` PR. If you
   started an extension branch and the dashboard needs you, stash it and
   switch back — root `CLAUDE.md` rule: "if `main` breaks, fixing it
   preempts all other work" applies by extension (no pun intended) to any
   P0 blocker versus this P2 folder.

---

## Task breakdown

| Task | Files | Branch | Depends on | Feature ID |
|---|---|---|---|---|
| Extension scaffold | `package.json`, `src/extension.ts` (activate/deactivate stubs) | `feat/d-ext-scaffold` | dashboard running on 5173, `GET /api/health` live | F14 |
| Status bar item | `src/extension.ts` (statusBarItem + poll) | `feat/d-ext-statusbar` | `feat/d-ext-scaffold` | F14 |
| Escalations tree provider | `src/escalationsTreeProvider.ts` | `feat/d-ext-escalations-tree` | `feat/d-ext-scaffold` | F14 |
| Investigations tree provider | `src/investigationsTreeProvider.ts` | `feat/d-ext-investigations-tree` | `feat/d-ext-scaffold` | F14 |
| Webview + CSP | `src/webview.ts` or inline in `extension.ts` | `feat/d-ext-webview` | `feat/d-ext-scaffold` | F14 |
| Critical-escalation toast | `src/extension.ts` (refreshAll diff logic) | `feat/d-ext-toast` | `feat/d-ext-escalations-tree` | F14 |
| Trigger-scan command | `src/extension.ts` command handler | `feat/d-ext-trigger-scan` | `feat/d-ext-scaffold` | F01, F14 |

---

## F19 — Auto-Fix PR, and why it lives here

`AUTO_FIX.md` specifies three UI surfaces for auto-fix: a dashboard badge, a
Chrome extension banner, and MCP. On this branch **only the VS Code surface is
built** — the dashboard and browser extension are demoed from their own
branches, so building their halves here would mean editing files two other
streams own (root `CLAUDE.md` §5) for a view nobody will show.

What was added, and nothing beyond it:

- `doombot.openFixPr`, contributed twice under `view/item/context` — once with
  `group: "inline"` (the hover button, which is what makes the gesture
  discoverable in a demo) and once under a named group (the right-click menu).
  `group: "inline"` alone renders *only* the hover button; the two entries are
  not redundant.
- `contextValue` on the row classes in `trees.ts`, set on real rows only. If a
  `MessageItem` ever gets one, "Open Auto-Fix PR" appears on the row that says
  "Queue is clear".
- `FixPrIndex` in `trees.ts` — session cache of which investigations have a
  draft fix PR, hydrated from the existing poll. No second timer.

This stays inside the folder's rules rather than bending them:

- **No third view.** The badge decorates the two existing trees.
- **No native re-implementation.** The diff, the evidence and the full chain
  are not rendered here — "Open investigation" routes to the dashboard, and
  "Open PR" hands off to GitHub. A menu item plus a toast is not a second
  design system.
- **No new contributed colour.** The badge reuses `doombot.success`.
- **No new dependency.**

### The one trap in it

The fix PR number is recovered from the investigation *chain*, not from a
field on `InvestigationSummary` — deliberately, because adding a field to
`api/schemas.py` would be a contract change requiring
`dashboard/src/lib/types.ts` to move in the same PR (root `CLAUDE.md` §7),
which is a dashboard file this branch has no business touching.

So the detection contract is: the `fix_pr_opener` step carries a `pr`-type
evidence entry whose `ref` is the bare PR number. `agents/triage/auto_fixer.py`
emits `type: "pr"` there **if and only if** a draft PR really exists, and
carries a comment saying so. If someone later "tidies" that `ref` into a URL,
the badge silently stops appearing and `tsc` will not notice — same class of
bug as every row in the contract-traps table in `README.md`.

---

## Definition of done

- [ ] Extension activates without errors against a running dashboard +
      backend on default ports
- [ ] Status bar shows health score and pending escalation count, updating
      on the poll interval
- [ ] Escalation tree view lists current escalations with severity-coded
      icons (icon + label, matching `dashboard/CLAUDE.md` §8's
      never-color-alone rule)
- [ ] Selecting a tree item opens the dashboard webview to the relevant
      route
- [ ] A new critical escalation triggers exactly one toast per increase,
      no duplicate spam on every poll tick
- [ ] Webview CSP is scoped to the configured dashboard URL, not a wildcard
- [ ] No diagnostics provider, CodeLens, second design system, or
      duplicated React exists anywhere in this folder
- [ ] `vscode-extension/README.md` updated to match this file instead of
      the older single-iframe-only description
