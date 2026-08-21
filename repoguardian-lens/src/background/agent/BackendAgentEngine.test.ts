import { afterEach, describe, expect, it, vi } from 'vitest'

import { BackendAgentEngine } from './BackendAgentEngine'
import { LiveAgentEngine } from './LiveAgentEngine'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const PROPOSED_ACTION = {
  id: 'action-1',
  investigation_id: 'abc-123',
  repo_name: 'aryabailur/Doombot',
  issue_number: 4,
  action: 'escalate',
  comment: 'Exact public comment',
  labels: ['needs-triage'],
  status: 'proposed',
  decided_by: null,
  decision_note: null,
  result: null,
  error: null,
  created_at: '2026-08-20T12:00:11Z',
  decided_at: null,
  executed_at: null,
} as const

const FIX_RUN = {
  id: 'fix-1',
  investigation_id: 'abc-123',
  repo_name: 'aryabailur/Doombot',
  issue_number: 4,
  status: 'proposed',
  base_sha: 'abc123',
  summary: 'Avoid logging the raw credential.',
  patch_diff: 'diff --git a/api/auth.py b/api/auth.py\n',
  commands: [['python', '-m', 'pytest', '-q']],
  receipts: [{
    command: ['python', '-m', 'pytest', '-q'],
    exit_code: 0,
    duration_ms: 1200,
    stdout: '1 passed',
    stderr: '',
    containerized: true,
    network_disabled: true,
    image: 'repoguardian-fixlab-python:local',
    image_digest: 'sha256:abc123',
  }],
  error: null,
} as const

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
  proposed_action: PROPOSED_ACTION,
  steps: [
    { step_id: 's0', seq: 0, name: 'issue_fetcher', title: 'Fetching issue', status: 'done', input_summary: 'issue #4', output_summary: 'Fetched issue #4', evidence: [{ type: 'issue', ref: '4', score: null, snippet: 'Cannot authenticate' }], duration_ms: 300, started_at: '2026-08-20T12:00:00Z', ended_at: '2026-08-20T12:00:01Z' },
    { step_id: 'code', seq: 1, name: 'code_investigator', title: 'Mapping issue to code', status: 'done', input_summary: 'issue #4', output_summary: 'code_diagnosis=7', evidence: [{ type: 'file', ref: 'api/auth.py:42', score: 0.78, snippet: 'Candidate · authenticate: def authenticate(token):' }, { type: 'rule', ref: 'root_cause_hypothesis', score: 0.72, snippet: 'The refreshed token format appears to be rejected.' }], duration_ms: 250, started_at: '2026-08-20T12:00:01Z', ended_at: '2026-08-20T12:00:02Z' },
    { step_id: 's1', seq: 2, name: 'duplicate_detector', title: 'Searching for duplicates', status: 'done', input_summary: 'issue #4', output_summary: 'Found 1 related issue', evidence: [{ type: 'issue', ref: '3', score: 0.71, snippet: 'Login fails with 401' }], duration_ms: 900, started_at: '2026-08-20T12:00:02Z', ended_at: '2026-08-20T12:00:03Z' },
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
  it('starts a fix run and maps its isolated verification receipt', async () => {
    const fetchMock = vi.fn(async (rawUrl: string, init?: RequestInit) => {
      expect(new URL(rawUrl).pathname).toBe('/api/fix-runs')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ investigation_id: 'abc-123' })
      return new Response(JSON.stringify(FIX_RUN), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new BackendAgentEngine('http://localhost:8000').startFixRun('abc-123')

    expect(result).toMatchObject({ id: 'fix-1', status: 'proposed', baseSha: 'abc123' })
    expect(result.receipts[0]).toMatchObject({
      exitCode: 0,
      containerized: true,
      networkDisabled: true,
      imageDigest: 'sha256:abc123',
    })
  })

  it('records a fix review without claiming to publish it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (rawUrl: string, init?: RequestInit) => {
      expect(new URL(rawUrl).pathname).toBe('/api/fix-runs/fix-1/decision')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        approved: true,
        decided_by: 'RepoGuardian Lens maintainer',
      })
      return new Response(JSON.stringify({ ...FIX_RUN, status: 'approved' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const result = await new BackendAgentEngine('http://localhost:8000').decideFixRun('fix-1', true)

    expect(result.status).toBe('approved')
    expect(result.status).not.toBe('published')
  })

  it('maps a completed backend run onto the UI contract', async () => {
    const { calls } = stubBackend()
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
    expect(result.approval).toMatchObject({
      id: 'action-1',
      status: 'proposed',
      live: true,
    })
    expect(result.approval?.detail).toContain('Exact public comment')
    expect(result.insight.evidence).toContainEqual(expect.objectContaining({
      id: 'api/auth.py:42',
      type: 'file',
      url: 'https://github.com/aryabailur/Doombot/blob/HEAD/api/auth.py#L42',
    }))
    expect(result.events.find((event) => event.id === 'code')?.detail)
      .toBe('Found 1 candidate code location; similarity does not prove root cause.')
    expect(calls).toContain('POST /api/repos/aryabailur/Doombot/index')
  })

  it('sends approval decisions to the persisted backend action endpoint', async () => {
    const fetchMock = vi.fn(async (rawUrl: string, init?: RequestInit) => {
      expect(new URL(rawUrl).pathname).toBe('/api/actions/action-1/decision')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        approved: false,
        decided_by: 'RepoGuardian Lens maintainer',
      })
      return new Response(JSON.stringify({
        ...PROPOSED_ACTION,
        status: 'rejected',
        decided_by: 'RepoGuardian Lens maintainer',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new BackendAgentEngine('http://localhost:8000').decideAction({
      id: 'action-1',
      kind: 'github_update',
      title: 'Review escalation proposal',
      detail: 'Exact public comment',
      reason: 'Needs attention',
      evidence: [],
      status: 'proposed',
      live: true,
    }, false)

    expect(result.status).toBe('rejected')
    expect(result.live).toBe(true)
  })

  it('adds decision-derived policy to live repository memory', async () => {
    const fallback = vi.spyOn(LiveAgentEngine.prototype, 'getRepositoryMemory')
      .mockResolvedValue({
        indexed: { commits: 12, issues: 4, pullRequests: 2, contributors: 3 },
        groups: [],
      })
    vi.stubGlobal('fetch', vi.fn(async (rawUrl: string) => {
      expect(new URL(rawUrl).pathname).toBe('/api/policy')
      return new Response(JSON.stringify({
        repo_name: 'owner/repo',
        mode: 'learned',
        minimum_samples: 3,
        total_decisions: 4,
        approvals: 3,
        rejections: 1,
        approval_rate: 0.75,
        actions: [{
          action: 'escalate', samples: 4, approvals: 3, rejections: 1,
          approval_rate: 0.75, guidance: 'aligned',
        }],
        labels: [],
        learned_rules: ['Every GitHub write still requires approval.'],
        updated_at: '2026-08-21T00:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const memory = await new BackendAgentEngine('http://localhost:8000')
      .getRepositoryMemory({ owner: 'owner', repo: 'repo' })

    expect(memory.policy).toMatchObject({
      mode: 'learned',
      totalDecisions: 4,
      approvalRate: 0.75,
    })
    expect(memory.policy?.actions[0]).toMatchObject({
      action: 'escalate',
      guidance: 'aligned',
    })
    fallback.mockRestore()
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

  it('retries the creation race when the first detail request is 404', async () => {
    let poll = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ investigation_id: 'abc-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      poll += 1
      if (poll === 1) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify(RUN), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const result = await new BackendAgentEngine('http://localhost:8000').investigateIssue({
      owner: 'aryabailur', repo: 'Doombot', issueNumber: 4,
    })
    expect(poll).toBe(2)
    expect(result.insight.decision).toBe('escalate')
  })

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
    // "rule" evidence is internal arithmetic, while file candidates remain
    // openable. Several nodes cite the same issue, so ids stay deduplicated.
    expect(ids).not.toContain('api key')
    expect(ids).not.toContain('base')
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['#4', 'api/auth.py:42', '#3'])
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
    expect(factors).toContain('Code hypothesis (72%)')
    // A mid-sentence slice of the issue body must never reach the UI.
    expect(factors).not.toContain('Traceback')
    expect(factors).not.toContain('most recent call last')
  })

  it('translates backend counters and point contributions into truthful trace text', async () => {
    const steps = [
      ...RUN.steps.slice(0, 2),
      {
        step_id: 'resolver', seq: 2, name: 'resolver', title: 'Looking for a known fix', status: 'done',
        input_summary: 'issue #4', output_summary: 'resolution',
        evidence: [{ type: 'rule', ref: 'no_similar_resolved', score: null, snippet: 'no closed issue above 0.75 similarity' }],
        duration_ms: 20, started_at: RUN.created_at, ended_at: RUN.completed_at,
      },
      {
        step_id: 'impact', seq: 3, name: 'impact_scorer', title: 'Scoring impact', status: 'done',
        input_summary: 'issue #4', output_summary: 'impact_score=8',
        evidence: [
          { type: 'rule', ref: 'base', score: 5, snippet: 'flat baseline' },
          { type: 'rule', ref: 'participants', score: 3, snippet: 'one participant' },
        ],
        duration_ms: 0, started_at: RUN.created_at, ended_at: RUN.completed_at,
      },
      {
        step_id: 'labeler', seq: 4, name: 'labeler', title: 'Classifying and labeling', status: 'done',
        input_summary: 'issue #4', output_summary: 'labels=1, labels_confidence=0.45, labels_suggested=True',
        evidence: [
          { type: 'rule', ref: 'classification', score: 0.45, snippet: 'generic test issue' },
          { type: 'rule', ref: 'auto_apply_threshold', score: 0.85, snippet: 'suggest only' },
        ],
        duration_ms: 100, started_at: RUN.created_at, ended_at: RUN.completed_at,
      },
      {
        step_id: 'decider', seq: 5, name: 'decider', title: 'Deciding next action', status: 'done',
        input_summary: 'issue #4', output_summary: 'decision=4',
        evidence: [
          { type: 'rule', ref: 'no_action', score: 0.5, snippet: 'no signal' },
          { type: 'rule', ref: 'demo_mode', score: null, snippet: 'nothing posted' },
        ],
        duration_ms: 0, started_at: RUN.created_at, ended_at: RUN.completed_at,
      },
    ]
    stubBackend({ ...RUN, decision: 'no_action', confidence: 0.5, impact_score: 8, steps })

    const result = await new BackendAgentEngine('http://localhost:8000').investigateIssue({
      owner: 'octocat', repo: 'Hello-World', issueNumber: 10906,
    })

    const byId = new Map(result.events.map((event) => [event.id, event]))
    expect(byId.get('resolver')?.detail).toBe('No similar closed issue with a recorded fix was found.')
    expect(byId.get('impact')?.detail).toBe('Impact score: 8/100.')
    expect(byId.get('impact')?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'base +5 points', score: undefined }),
      expect.objectContaining({ id: 'participants +3 points', score: undefined }),
    ]))
    expect(byId.get('labeler')?.detail).toBe('Suggested 1 label at 45% confidence; maintainer approval is required.')
    expect(byId.get('decider')?.detail).toBe('Recommended: stay silent (50% policy confidence).')
    expect(byId.get('decider')?.sources?.map((source) => source.id)).toEqual(['Stay silent', 'Dry run'])
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

  it('builds the attention queue from persisted backend decisions', async () => {
    const fetchMock = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/escalations') {
        return new Response(JSON.stringify([{
          investigation_id: RUN.investigation_id,
          reason: RUN.decision_reason,
          severity: 'critical',
          number: RUN.number,
          title: RUN.title,
          created_at: RUN.created_at,
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.pathname === '/api/investigations') {
        return new Response(JSON.stringify([
          RUN,
          { ...RUN, investigation_id: 'quiet-1', number: 3, decision: 'no_action' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify(RUN), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const activity = await new BackendAgentEngine('http://localhost:8000').getActivity({
      owner: 'aryabailur',
      repo: 'Doombot',
    })

    expect(activity.source).toBe('backend')
    expect(activity.attentionCount).toBe(1)
    expect(activity.automatedCount).toBe(1)
    expect(activity.items).toEqual([{
      issueNumber: 4,
      title: RUN.title,
      confidence: 0.91,
      severity: 'critical',
    }])
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes('repo_name=aryabailur%2FDoombot'),
    )).toBe(true)
  })
})
