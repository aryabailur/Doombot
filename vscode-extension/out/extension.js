"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const api_1 = require("./api");
const trees_1 = require("./trees");
let statusBarItem;
let escalations;
let investigations;
let pollTimer;
let panel;
/** Last seen critical count, so a rise can raise a toast. */
let lastCriticalCount = 0;
function activate(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'doombot.openDashboard';
    statusBarItem.text = '$(sync~spin) Doombot';
    statusBarItem.tooltip = 'Doombot — connecting to the API';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    escalations = new trees_1.EscalationsTreeProvider();
    investigations = new trees_1.InvestigationsTreeProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('doombot.escalations', escalations), vscode.window.registerTreeDataProvider('doombot.investigations', investigations), vscode.commands.registerCommand('doombot.openDashboard', (route) => openDashboard(context, route)), vscode.commands.registerCommand('doombot.triggerScan', triggerScan), vscode.commands.registerCommand('doombot.refreshEscalations', () => refreshAll()));
    pollTimer = setInterval(() => void refreshAll(), (0, api_1.pollSeconds)() * 1000);
    void refreshAll();
}
function deactivate() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
    }
}
/**
 * One poll drives the status bar, both trees, and the toast.
 *
 * Polling REST rather than opening a second WebSocket: the webview already
 * holds a live socket via the dashboard, and two independent realtime
 * channels in one stretch feature is complexity without payoff.
 */
async function refreshAll() {
    await Promise.all([escalations.refresh(), investigations.refresh()]);
    const repo = (0, api_1.repository)();
    const health = repo ? await (0, api_1.getHealth)(repo) : null;
    const pending = escalations.pendingCount();
    const healthText = health ? `${Math.round(health.score)}` : '--';
    statusBarItem.text = `$(shield) Doombot ${healthText} · ${pending} open`;
    statusBarItem.tooltip = new vscode.MarkdownString(repo
        ? `**${repo}**\n\nHealth: ${healthText}/100\n\n${pending} open escalation${pending === 1 ? '' : 's'}`
        : 'Set `doombot.repository` to see a health score.');
    // Deliberately dumb: a rise in the critical count is the trigger, with no
    // dedup or cooldown. The contract asks for exactly this and nothing more.
    const critical = escalations.criticalCount();
    if (critical > lastCriticalCount) {
        const added = critical - lastCriticalCount;
        void vscode.window
            .showErrorMessage(`Doombot: ${added} new critical escalation${added === 1 ? '' : 's'}.`, 'Open dashboard')
            .then((choice) => {
            if (choice === 'Open dashboard') {
                void vscode.commands.executeCommand('doombot.openDashboard', '/escalations');
            }
        });
    }
    lastCriticalCount = critical;
}
/** Prompts for an issue number and starts an investigation (F01). */
async function triggerScan() {
    const repo = (0, api_1.repository)();
    if (!repo.includes('/')) {
        void vscode.window.showWarningMessage('Set `doombot.repository` to owner/repo first.');
        return;
    }
    const input = await vscode.window.showInputBox({
        prompt: `Issue number to investigate in ${repo}`,
        validateInput: (value) => /^\d+$/.test(value.trim()) ? null : 'Enter an issue number.',
    });
    if (!input) {
        return;
    }
    const started = await (0, api_1.createInvestigation)(repo, 'issue', Number(input.trim()));
    if (started) {
        void vscode.window.showInformationMessage(`Doombot is investigating ${repo}#${input.trim()}.`);
        await refreshAll();
    }
    else {
        void vscode.window.showErrorMessage('Could not start the investigation. Is the API running on port 8000?');
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
function openDashboard(context, route) {
    const target = `${(0, api_1.dashboardUrl)()}${route ?? '/overview'}`;
    if (panel) {
        panel.reveal();
        panel.webview.html = dashboardHtml(target);
        return;
    }
    panel = vscode.window.createWebviewPanel('doombot.dashboard', 'Doombot', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = dashboardHtml(target);
    panel.onDidDispose(() => {
        panel = undefined;
    }, null, context.subscriptions);
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
function dashboardHtml(target) {
    const origin = new URL(target).origin;
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
</html>`;
}
//# sourceMappingURL=extension.js.map