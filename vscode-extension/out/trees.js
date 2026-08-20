"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvestigationsTreeProvider = exports.EscalationsTreeProvider = void 0;
const vscode = require("vscode");
const api_1 = require("./api");
/**
 * Severity to VS Code theme icon.
 *
 * Uses the editor's own theme colours rather than the dashboard's tokens.
 * That is deliberate: a tree item painted with hardcoded hexes would clash
 * with whatever theme the user runs, and DESIGN.md 4 treats "adds a second
 * inconsistent design system" as a spec conflict. The dashboard's palette
 * belongs in the dashboard; native chrome should look native.
 *
 * Every item still carries its severity as text in the label, so the icon is
 * never the only signal.
 */
function severityIcon(severity) {
    switch (severity.toLowerCase()) {
        case 'critical':
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        case 'high':
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
        case 'warning':
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
        default:
            return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.blue'));
    }
}
function statusIcon(status) {
    switch (status) {
        case 'completed':
            return new vscode.ThemeIcon('pass');
        case 'error':
            return new vscode.ThemeIcon('error');
        default:
            return new vscode.ThemeIcon('sync~spin');
    }
}
/** A leaf whose only job is to explain why the tree is empty. */
class MessageItem extends vscode.TreeItem {
    constructor(label, tooltip) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = tooltip;
        this.iconPath = new vscode.ThemeIcon('circle-slash');
    }
}
class EscalationsTreeProvider {
    changed = new vscode.EventEmitter();
    onDidChangeTreeData = this.changed.event;
    items = [];
    reachable = true;
    /** Critical count, so extension.ts can diff it for the toast. */
    criticalCount() {
        return this.items.filter((item) => item.severity.toLowerCase() === 'critical')
            .length;
    }
    pendingCount() {
        return this.items.length;
    }
    async refresh() {
        const result = await (0, api_1.getEscalations)();
        this.reachable = result !== null;
        this.items = result ?? [];
        this.changed.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (!this.reachable) {
            return [
                new MessageItem('Backend unreachable', 'Start the API with: uvicorn api.main:app --reload --port 8000'),
            ];
        }
        if (this.items.length === 0) {
            return [
                new MessageItem('Queue is clear', 'Doombot found nothing needing a maintainer.'),
            ];
        }
        return this.items.map((escalation) => {
            const item = new vscode.TreeItem(`[${escalation.severity.toUpperCase()}] #${escalation.number} ${escalation.title}`, vscode.TreeItemCollapsibleState.None);
            item.iconPath = severityIcon(escalation.severity);
            item.description = escalation.reason;
            item.tooltip = new vscode.MarkdownString(`**#${escalation.number}** — ${escalation.title}\n\n` +
                `Severity: ${escalation.severity}\n\n${escalation.reason}`);
            // Anything richer than this opens the dashboard: the extension is a
            // companion, and full evidence exploration belongs there (DESIGN.md 7.9).
            item.command = {
                command: 'doombot.openDashboard',
                title: 'Open in dashboard',
                arguments: [`/investigations/${escalation.investigation_id}`],
            };
            return item;
        });
    }
}
exports.EscalationsTreeProvider = EscalationsTreeProvider;
class InvestigationsTreeProvider {
    changed = new vscode.EventEmitter();
    onDidChangeTreeData = this.changed.event;
    items = [];
    reachable = true;
    async refresh() {
        const result = await (0, api_1.getInvestigations)();
        this.reachable = result !== null;
        this.items = (result ?? []).slice(0, 15);
        this.changed.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (!this.reachable) {
            return [
                new MessageItem('Backend unreachable', 'Start the API on port 8000.'),
            ];
        }
        if (this.items.length === 0) {
            return [
                new MessageItem('No investigations yet', 'Run Doombot: Trigger Repository Scan to start one.'),
            ];
        }
        return this.items.map((investigation) => {
            const item = new vscode.TreeItem(`#${investigation.number} ${investigation.title}`, vscode.TreeItemCollapsibleState.None);
            item.iconPath = statusIcon(investigation.status);
            item.description = investigation.decision ?? investigation.status;
            item.tooltip = new vscode.MarkdownString(`**${investigation.repo_name}#${investigation.number}**\n\n` +
                `Status: ${investigation.status}\n\n` +
                `Decision: ${investigation.decision ?? 'pending'}`);
            item.command = {
                command: 'doombot.openDashboard',
                title: 'Open in dashboard',
                arguments: [`/investigations/${investigation.id}`],
            };
            return item;
        });
    }
}
exports.InvestigationsTreeProvider = InvestigationsTreeProvider;
//# sourceMappingURL=trees.js.map