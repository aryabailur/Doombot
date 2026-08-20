import * as vscode from 'vscode'

/**
 * Minimal REST client for the Doombot API.
 *
 * Shapes mirror `api/CLAUDE.md`'s endpoint table. They are declared here
 * rather than imported from the dashboard because this package has no build
 * relationship with it -- but they must stay in step with
 * `dashboard/src/lib/types.ts`, which mirrors the same contract.
 *
 * Node 18+ ships global fetch, which VS Code 1.85's runtime provides, so
 * there is no HTTP dependency to install.
 */

export interface Escalation {
  investigation_id: string
  reason: string
  severity: string
  number: number
  title: string
  created_at: string
}

export interface InvestigationSummary {
  id: string
  repo_name: string
  kind: string
  number: number
  title: string
  status: string
  decision: string | null
  created_at: string
}

export interface HealthResponse {
  score: number
  breakdown: Record<string, number>
  history: { ts: string; score: number }[]
}

function config() {
  return vscode.workspace.getConfiguration('doombot')
}

export function apiBaseUrl(): string {
  return config().get<string>('apiBaseUrl', 'http://localhost:8000')
}

export function dashboardUrl(): string {
  return config().get<string>('dashboardUrl', 'http://localhost:5173')
}

export function repository(): string {
  return config().get<string>('repository', '')
}

export function pollSeconds(): number {
  return Math.max(5, config().get<number>('pollSeconds', 15))
}

/**
 * GET a JSON endpoint, returning null on any failure.
 *
 * Returning null rather than throwing is deliberate: the backend not running
 * is the *expected* state for most of this extension's life, and a stack
 * trace in the Extension Host output every 15 seconds is worse than an
 * empty tree. Callers render an explicit "backend unreachable" node instead.
 */
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`)
    if (!response.ok) {
      return null
    }
    return (await response.json()) as T
  } catch {
    return null
  }
}

export function getEscalations(): Promise<Escalation[] | null> {
  return getJson<Escalation[]>('/api/escalations')
}

export function getInvestigations(): Promise<InvestigationSummary[] | null> {
  return getJson<InvestigationSummary[]>('/api/investigations')
}

export function getHealth(repo: string): Promise<HealthResponse | null> {
  if (!repo.includes('/')) {
    return Promise.resolve(null)
  }
  return getJson<HealthResponse>(`/api/repos/${repo}/health`)
}

/** Starts an investigation. Same endpoint the dashboard uses -- F01. */
export async function createInvestigation(
  repo: string,
  kind: 'issue' | 'pr',
  numberToScan: number,
): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl()}/api/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_name: repo,
        kind,
        number: numberToScan,
      }),
    })
    return response.ok
  } catch {
    return false
  }
}
