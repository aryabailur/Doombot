"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiBaseUrl = apiBaseUrl;
exports.dashboardUrl = dashboardUrl;
exports.repository = repository;
exports.pollSeconds = pollSeconds;
exports.getEscalations = getEscalations;
exports.getInvestigations = getInvestigations;
exports.getHealth = getHealth;
exports.createInvestigation = createInvestigation;
const vscode = require("vscode");
function config() {
    return vscode.workspace.getConfiguration('doombot');
}
function apiBaseUrl() {
    return config().get('apiBaseUrl', 'http://localhost:8000');
}
function dashboardUrl() {
    return config().get('dashboardUrl', 'http://localhost:5173');
}
function repository() {
    return config().get('repository', '');
}
function pollSeconds() {
    return Math.max(5, config().get('pollSeconds', 15));
}
/**
 * GET a JSON endpoint, returning null on any failure.
 *
 * Returning null rather than throwing is deliberate: the backend not running
 * is the *expected* state for most of this extension's life, and a stack
 * trace in the Extension Host output every 15 seconds is worse than an
 * empty tree. Callers render an explicit "backend unreachable" node instead.
 */
async function getJson(path) {
    try {
        const response = await fetch(`${apiBaseUrl()}${path}`);
        if (!response.ok) {
            return null;
        }
        return (await response.json());
    }
    catch {
        return null;
    }
}
function getEscalations() {
    return getJson('/api/escalations');
}
function getInvestigations() {
    return getJson('/api/investigations');
}
function getHealth(repo) {
    if (!repo.includes('/')) {
        return Promise.resolve(null);
    }
    return getJson(`/api/repos/${repo}/health`);
}
/** Starts an investigation. Same endpoint the dashboard uses -- F01. */
async function createInvestigation(repo, kind, numberToScan) {
    try {
        const response = await fetch(`${apiBaseUrl()}/api/investigations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repo_name: repo,
                kind,
                number: numberToScan,
            }),
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=api.js.map