import * as vscode from 'vscode'

import {
  createInvestigation,
  dashboardUrl,
  getHealth,
  pollSeconds,
  repository,
} from './api'
import { EscalationsTreeProvider, InvestigationsTreeProvider } from './trees'

let statusBarItem: vscode.StatusBarItem
let escalations: EscalationsTreeProvider
let investigations: InvestigationsTreeProvider
let pollTimer: ReturnType<typeof setInterval> | undefined
let panel: vscode.WebviewPanel | undefined

/**
 * Last seen critical count, so a rise can raise a toast.
 *
 * `undefined` until the first poll completes. Seeding it to 0 meant the
 * first poll after activation treated every already-open critical escalation
 * as brand new and fired a toast for a backlog the user had already seen --
 * the contract asks for a toast when the count *rises*, and establishing the
 * baseline is not a rise.
 */
let lastCriticalCount: number | undefined

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  )
  statusBarItem.command = 'doombot.openDashboard'
  statusBarItem.text = '$(sync~spin) Doombot'
  statusBarItem.tooltip = 'Doombot — connecting to the API'
  statusBarItem.show()
  context.subscriptions.push(statusBarItem)

  escalations = new EscalationsTreeProvider()
  investigations = new InvestigationsTreeProvider()

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('doombot.escalations', escalations),
    vscode.window.registerTreeDataProvider(
      'doombot.investigations',
      investigations,
    ),
    vscode.commands.registerCommand(
      'doombot.openDashboard',
      (route?: string) => openDashboard(context, route),
    ),
    // F15. Deliberately routes to the dashboard rather than rendering a
    // native graph: react-force-graph needs a canvas, and DESIGN.md 4 treats
    // reimplementing dashboard UI natively as a spec conflict.
    vscode.commands.registerCommand('doombot.openIssueGraph', () =>
      openDashboard(context, '/graph'),
    ),
    vscode.commands.registerCommand('doombot.triggerScan', triggerScan),
    vscode.commands.registerCommand('doombot.refreshEscalations', () =>
      refreshAll(),
    ),
  )

  // Re-arm on configuration change: the interval is read once when the timer
  // is created, so without this a new `doombot.pollSeconds` (or a corrected
  // apiBaseUrl) did nothing until the window was reloaded.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('doombot')) {
        return
      }
      startPolling()
      void refreshAll()
    }),
  )

  startPolling()
  void refreshAll()
}

/** (Re)starts the poll timer, replacing any existing one. */
function startPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
  }
  pollTimer = setInterval(() => void refreshAll(), pollSeconds() * 1000)
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
  // The panel is not in context.subscriptions (it is created on demand), so
  // it has to be disposed by hand or it outlives deactivation.
  panel?.dispose()
  panel = undefined
}

/**
 * One poll drives the status bar, both trees, and the toast.
 *
 * Polling REST rather than opening a second WebSocket: the webview already
 * holds a live socket via the dashboard, and two independent realtime
 * channels in one stretch feature is complexity without payoff.
 */
async function refreshAll(): Promise<void> {
  await Promise.all([escalations.refresh(), investigations.refresh()])

  const repo = repository()
  const health = repo ? await getHealth(repo) : null
  const pending = escalations.pendingCount()

  const healthText = health ? `${Math.round(health.score)}` : '--'
  statusBarItem.text = `$(shield) Doombot ${healthText} · ${pending} open`
  statusBarItem.tooltip = new vscode.MarkdownString(
    repo
      ? `**${repo}**\n\nHealth: ${healthText}/100\n\n${pending} open escalation${pending === 1 ? '' : 's'}`
      : 'Set `doombot.repository` to see a health score.',
  )

  // Deliberately dumb: a rise in the critical count is the trigger, with no
  // dedup or cooldown. The contract asks for exactly this and nothing more.
  const critical = escalations.criticalCount()
  if (lastCriticalCount !== undefined && critical > lastCriticalCount) {
    const added = critical - lastCriticalCount
    void vscode.window
      .showErrorMessage(
        `Doombot: ${added} new critical escalation${added === 1 ? '' : 's'}.`,
        'Open dashboard',
      )
      .then((choice) => {
        if (choice === 'Open dashboard') {
          void vscode.commands.executeCommand(
            'doombot.openDashboard',
            '/escalations',
          )
        }
      })
  }
  lastCriticalCount = critical
}

/** Prompts for an issue number and starts an investigation (F01). */
async function triggerScan(): Promise<void> {
  const repo = repository()
  if (!repo.includes('/')) {
    void vscode.window.showWarningMessage(
      'Set `doombot.repository` to owner/repo first.',
    )
    return
  }

  const input = await vscode.window.showInputBox({
    prompt: `Issue number to investigate in ${repo}`,
    validateInput: (value) =>
      /^\d+$/.test(value.trim()) ? null : 'Enter an issue number.',
  })
  if (!input) {
    return
  }

  const started = await createInvestigation(repo, 'issue', Number(input.trim()))
  if (started) {
    void vscode.window.showInformationMessage(
      `Doombot is investigating ${repo}#${input.trim()}.`,
    )
    await refreshAll()
  } else {
    void vscode.window.showErrorMessage(
      'Could not start the investigation. Is the API running on port 8000?',
    )
  }
}

/**
 * Opens the dashboard in a webview panel.
 *
 * The panel iframes the dashboard rather than reimplementing any of it. That
 * is the whole design: DESIGN.md 4 treats "makes the VS Code extension a
 * separate product with different logic" as a spec conflict, so the
 * extension shows the same UI C and D already built.
 */
function openDashboard(
  context: vscode.ExtensionContext,
  route?: string,
): void {
  const target = `${dashboardUrl()}${route ?? '/overview'}`

  if (panel) {
    panel.reveal()
    panel.webview.html = dashboardHtml(target)
    return
  }

  panel = vscode.window.createWebviewPanel(
    'doombot.dashboard',
    'Doombot',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  )
  panel.webview.html = dashboardHtml(target)
  panel.onDidDispose(
    () => {
      panel = undefined
    },
    null,
    context.subscriptions,
  )
}

/**
 * Webview shell that frames the dashboard.
 *
 * A webview's default CSP blocks framing entirely, so `frame-src` must name
 * the dashboard origin explicitly or the panel renders blank with only a
 * console error -- the single most likely way this feature appears broken.
 * The origin comes from configuration, so it is interpolated rather than
 * hardcoded.
 */
function dashboardHtml(target: string): string {
  const origin = new URL(target).origin
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline';">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  iframe { border: 0; width: 100%; height: 100vh; display: block; }
  .fallback { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
</style>
</head>
<body>
<iframe src="${target}" title="Doombot dashboard"></iframe>
<noscript><p class="fallback">Enable scripts to view the Doombot dashboard.</p></noscript>
</body>
</html>`
}
