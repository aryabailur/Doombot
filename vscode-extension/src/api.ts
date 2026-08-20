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

/** Exactly the values `api/schemas.py` emits -- not free-form strings. */
export type InvestigationStatus = 'running' | 'done' | 'error'

export interface InvestigationSummary {
  // `investigation_id`, not `id` -- api/CLAUDE.md's InvestigationSummary.
  // Caught by tests/test_api_contract.py after this was written wrong.
  investigation_id: string
  repo_name: string
  kind: 'issue' | 'pr'
  number: number
  title: string
  status: InvestigationStatus
  decision: string | null
  created_at: string
  // Present on every response; omitting it here made the mirror silently
  // narrower than the contract it claims to mirror.
  completed_at: string | null
}

/** Mirrors HealthBreakdown -- four fixed axes, not an open map. */
export interface HealthBreakdown {
  security: number
  staleness: number
  duplication: number
  responsiveness: number
}

export interface HealthResponse {
  score: number
  breakdown: HealthBreakdown
  history: { ts: string; score: number }[]
  /**
   * False when the repository has no issues to score.
   *
   * Three of the four sub-scores return 100 for an empty backlog, so without
   * this the status bar reported a confident "Doombot 100" for a repository
   * nothing had ever been read from. Defaulted for older API builds that do
   * not send it.
   */
  measured?: boolean
  issue_count?: number
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

/**
 * Scoped to `doombot.repository` when it is set.
 *
 * The API grew a ?repo_name filter and the dashboard uses it, so an unscoped
 * tree here would list another repository's work beside the health score of
 * the configured one -- two panels disagreeing about which repo is on screen.
 * Unset means unscoped, which is the right default for a global queue.
 */
function repoQuery(): string {
  const repo = repository()
  return repo.includes('/') ? `?repo_name=${encodeURIComponent(repo)}` : ''
}

export function getEscalations(): Promise<Escalation[] | null> {
  return getJson<Escalation[]>(`/api/escalations${repoQuery()}`)
}

export function getInvestigations(): Promise<InvestigationSummary[] | null> {
  return getJson<InvestigationSummary[]>(`/api/investigations${repoQuery()}`)
}

/** Investigate a repository's open issues (the dashboard's Analyse action). */
export async function scanRepository(repo: string, limit = 5): Promise<boolean> {
  try {
    const response = await fetch(
      `${apiBaseUrl()}/api/repos/${repo}/scan?limit=${limit}`,
      { method: 'POST' },
    )
    return response.ok
  } catch {
    return false
  }
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
