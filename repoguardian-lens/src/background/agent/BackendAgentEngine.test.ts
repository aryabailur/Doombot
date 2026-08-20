import { afterEach, describe, expect, it, vi } from 'vitest'

import { BackendAgentEngine } from './BackendAgentEngine'

afterEach(() => vi.unstubAllGlobals())

/** A completed triage run, shaped exactly as api/schemas.py returns it. */
const RUN = {
  investigation_id: 'abc-123',
  repo_name: 'aryabailur/Doombot',
  kind: 'issue',
  number: 4,
  title: 'Cannot authenticate after v2.1 update - API_KEY exposed in traceback',
  status: 'done',
  decision: 'escalate',
  created_at: '2026-08-20T12:00:00Z',
  completed_at: '2026-08-20T12:00:11Z',
  decision_reason: 'Security finding: a credential is written to stdout on the auth failure path.',
  confidence: 0.91,
  impact_score: 88,
  steps: [
    { step_id: 's0', seq: 0, name: 'issue_fetcher', title: 'Fetching issue', status: 'done', input_summary: 'issue #4', output_summary: 'Fetched issue #4', evidence: [{ type: 'issue', ref: '4', score: null, snippet: 'Cannot authenticate' }], duration_ms: 300, started_at: '2026-08-20T12:00:00Z', ended_at: '2026-08-20T12:00:01Z' },
    { step_id: 's1', seq: 1, name: 'duplicate_detector', title: 'Searching for duplicates', status: 'done', input_summary: 'issue #4', output_summary: 'Found 1 related issue', evidence: [{ type: 'issue', ref: '3', score: 0.71, snippet: 'Login fails with 401' }], duration_ms: 900, started_at: '2026-08-20T12:00:01Z', ended_at: '2026-08-20T12:00:02Z' },
    { step_id: 's2', seq: 2, name: 'security_scanner', title: 'Scanning for security concerns', status: 'done', input_summary: 'issue #4', output_summary: 'Matched api key', evidence: [{ type: 'rule', ref: 'api key', score: null, snippet: 'prints the raw API_KEY value' }], duration_ms: 120, started_at: '2026-08-20T12:00:02Z', ended_at: '2026-08-20T12:00:03Z' },
    { step_id: 's3', seq: 3, name: 'decider', title: 'Deciding next action', status: 'done', input_summary: 'signals', output_summary: 'escalate', evidence: [], duration_ms: 80, started_at: '2026-08-20T12:00:03Z', ended_at: '2026-08-20T12:00:04Z' },
  ],
}

function stubBackend(run: unknown = RUN) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
    const body = new URL(url).pathname.endsWith('/api/investigations') && init?.method === 'POST'
      ? { investigation_id: 'abc-123' }
      : run
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  return { calls }
}

describe('BackendAgentEngine', () => {
  it('maps a completed backend run onto the UI contract', async () => {
    stubBackend()
    const result = await new BackendAgentEngine('http://localhost:8000').investigateIssue({
      owner: 'aryabailur', repo: 'Doombot', issueNumber: 4,
    })

    expect(result.insight.decision).toBe('escalate')
    expect(result.insight.confidence).toBe(0.91)
    expect(result.insight.summary).toContain('credential')

    // snake_case -> camelCase, and "pr" -> "pull_request".
    const ids = result.insight.evidence.map((item) => item.id)
    expect(ids).toContain('#3')
    expect(result.insight.evidence.find((item) => item.id === '#3')?.url)
      .toBe('https://github.com/aryabailur/Doombot/issues/3')

    // Backend node names map to the UI state machine, bracketed by queued/completed.
    const states = result.events.map((event) => event.state)
    expect(states[0]).toBe('queued')
    expect(states).toContain('reading')
    expect(states).toContain('deciding')
    expect(states[states.length - 1]).toBe('completed')
  })

  it('polls until the run finishes rather than reporting a partial result', async () => {
    let poll = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ investigation_id: 'abc-123' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      poll += 1
      const body = poll < 3 ? { ...RUN, status: 'running', decision: null, steps: [] } : RUN
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const result = await new BackendAgentEngine('http://localhost:8000').investigateIssue({
      owner: 'aryabailur', repo: 'Doombot', issueNumber: 4,
    })
    expect(poll).toBeGreaterThanOrEqual(3)
    expect(result.insight.decision).toBe('escalate')
  }, 20000)

  it('raises rather than presenting a failed graph run as a decision', async () => {
    stubBackend({ ...RUN, decision: 'error', decision_reason: 'unhandled errors in a TaskGroup', steps: [] })
    await expect(
      new BackendAgentEngine('http://localhost:8000').investigateIssue({ owner: 'a', repo: 'b', issueNumber: 1 }),
    ).rejects.toThrow(/TaskGroup/)
  })

  it('reports an unreachable backend as recoverable so the UI can fall back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused') }))
    await expect(
      new BackendAgentEngine('http://localhost:8000').getRepositoryHealth({ owner: 'a', repo: 'b' }),
    ).rejects.toMatchObject({ status: 0, recoverable: true })
  })

  it('keeps scorer internals out of the evidence chips', async () => {
    stubBackend()
    const result = await new BackendAgentEngine('http://localhost:8000').investigateIssue({
      owner: 'aryabailur', repo: 'Doombot', issueNumber: 4,
    })
    const ids = result.insight.evidence.map((item) => item.id)
    // "rule" evidence is the impact scorer's arithmetic, not something a
    // maintainer can open, and several nodes cite the same issue.
    expect(ids).not.toContain('api key')
    expect(ids).not.toContain('base')
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['#4', '#3'])
  })

  it('renders factors from semantic refs, not raw body snippets', async () => {
    stubBackend()
    const result = await new BackendAgentEngine('http://localhost:8000').investigateIssue({
      owner: 'aryabailur', repo: 'Doombot', issueNumber: 4,
    })
    const factors = result.insight.factors.join(' | ')
    expect(factors).toContain('Security-sensitive terms')
    expect(factors).toContain('api key')
    expect(factors).toContain('Related to #3')
    // A mid-sentence slice of the issue body must never reach the UI.
    expect(factors).not.toContain('Traceback')
    expect(factors).not.toContain('most recent call last')
  })

  it('maps the four-axis health breakdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        score: 83.4,
        breakdown: { security: 90, staleness: 71, duplication: 88, responsiveness: 42 },
        history: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))

    const health = await new BackendAgentEngine('http://localhost:8000').getRepositoryHealth({ owner: 'a', repo: 'b' })
    expect(health.score).toBe(83)
    expect(health.metrics).toHaveLength(4)
    // Responsiveness at 42 is below the midpoint and must be flagged.
    expect(health.metrics.find((m) => m.label === 'Responsiveness')?.concern).toBe(true)
  })
})
