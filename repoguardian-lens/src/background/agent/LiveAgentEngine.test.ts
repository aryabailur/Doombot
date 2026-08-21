import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitHubClient, toIssueRecord } from './GitHubClient'
import { LiveAgentEngine } from './LiveAgentEngine'
import { decideLiveIssue } from './liveDecisions'
import { searchLiveIssues } from './retrieval'
import type { IssueRecord } from '@/lib/types'

const repository = 'octocat/example'

afterEach(() => {
  GitHubClient.clearCache()
  vi.unstubAllGlobals()
})

function issue(partial: Partial<IssueRecord> & { number: number; title: string }): IssueRecord {
  return {
    body: '',
    subsystem: 'general',
    labels: [],
    symptoms: [partial.title.toLowerCase()],
    ...partial,
  }
}

describe('toIssueRecord', () => {
  it('derives subsystem, environment, and symptoms from raw GitHub JSON', () => {
    const record = toIssueRecord({
      number: 12,
      title: 'OAuth token refresh fails after upgrading',
      body: 'Our refresh token expires unexpectedly. Running Node 20.1 on Ubuntu 22.04.',
      labels: [{ name: 'bug' }, 'regression'],
      state: 'open',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      comments: 2,
    })

    expect(record.subsystem).toBe('authentication')
    expect(record.labels).toEqual(['bug', 'regression'])
    expect(record.environment).toBeDefined()
    expect(record.symptoms.length).toBeGreaterThan(0)
  })

  it('treats a missing body as empty rather than throwing', () => {
    const record = toIssueRecord({
      number: 3,
      title: 'Crash on startup',
      body: null,
      labels: [],
      state: 'open',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      comments: 0,
    })
    expect(record.body).toBe('')
    expect(record.environment).toBeUndefined()
  })
})

describe('live activity source', () => {
  it('requests only open issues for the attention queue', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/issues?')
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const activity = await new LiveAgentEngine().getActivity({
      owner: 'octocat',
      repo: 'example',
    })

    expect(activity.source).toBe('github')
    expect(String(fetchMock.mock.calls[0][0])).toContain('issues?state=open')
  })
})

describe('live repository questions', () => {
  const rawIssues = [
    {
      number: 4,
      title: 'Cannot authenticate after v2.1 update - API_KEY exposed in traceback',
      body: 'Updating to v2.1 returns 401 with the correct password and prints the raw API_KEY value to logs.',
      labels: [{ name: 'bug' }, { name: 'security' }],
      state: 'open',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-04T00:00:00Z',
      comments: 2,
    },
    {
      number: 6,
      title: 'Login broken with 401 after v2.1 upgrade',
      body: 'After upgrading to v2.1 login returns 401.',
      labels: [{ name: 'bug' }],
      state: 'open',
      created_at: '2026-08-02T00:00:00Z',
      updated_at: '2026-08-03T00:00:00Z',
      comments: 0,
    },
    {
      number: 3,
      title: 'Login fails with 401 after upgrading to v2.1',
      body: 'Upgraded to v2.1, now login fails with a 401 error.',
      labels: [{ name: 'bug' }],
      state: 'open',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-02T00:00:00Z',
      comments: 0,
    },
  ]

  function stubIssueCorpus() {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(rawIssues), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })))
  }

  it('grounds security and similar-bug questions in the issue visible on GitHub', async () => {
    stubIssueCorpus()
    const engine = new LiveAgentEngine()
    const input = {
      owner: 'aryabailur',
      repo: 'Doombot',
      context: { type: 'issue' as const, owner: 'aryabailur', repo: 'Doombot', issueNumber: 4 },
    }

    const security = await engine.answerQuestion({
      ...input,
      question: 'What evidence supports treating this as a security concern?',
    })
    const similar = await engine.answerQuestion({ ...input, question: 'Find similar bugs' })

    expect(security.answer.toLowerCase()).toContain('security')
    expect(security.evidence.map((item) => item.id)).toContain('#4')
    expect(similar.evidence.map((item) => item.id)).toEqual(expect.arrayContaining(['#6', '#3']))
  })

  it('answers every repository-wide suggested prompt from GitHub-derived data', async () => {
    stubIssueCorpus()
    const engine = new LiveAgentEngine()
    const base = { owner: 'aryabailur', repo: 'Doombot' }

    const authentication = await engine.answerQuestion({ ...base, question: 'Show authentication issues' })
    const recent = await engine.answerQuestion({ ...base, question: 'What changed recently?' })

    expect(authentication.evidence.length).toBeGreaterThan(0)
    expect(authentication.answer).toContain('authentication-related')
    expect(recent.evidence.map((item) => item.id)).toEqual(['#4', '#6', '#3'])
    expect(recent.answer).toContain('most recently updated')
  })
})

describe('searchLiveIssues', () => {
  const corpus = [
    issue({ number: 1, title: 'OAuth refresh token expires early', subsystem: 'authentication', labels: ['bug'] }),
    issue({ number: 2, title: 'Docs typo in README', subsystem: 'documentation' }),
    issue({ number: 3, title: 'Refresh token rotation fails', subsystem: 'authentication', labels: ['bug'] }),
  ]

  it('ranks same-subsystem textual matches above unrelated issues', () => {
    const target = issue({
      number: 99,
      title: 'OAuth refresh token expires early',
      subsystem: 'authentication',
      labels: ['bug'],
    })
    const results = searchLiveIssues({ target, corpus, repository })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('#1')
    expect(results.map((result) => result.id)).not.toContain('#2')
  })

  it('never returns the target issue as its own evidence', () => {
    const target = corpus[0]
    const results = searchLiveIssues({ target, corpus, repository })
    expect(results.map((result) => result.id)).not.toContain('#1')
  })

  it('explains why each result matched', () => {
    const target = issue({ number: 99, title: 'Refresh token rotation fails', subsystem: 'authentication', labels: ['bug'] })
    for (const result of searchLiveIssues({ target, corpus, repository })) {
      expect(result.whyMatched.length).toBeGreaterThan(0)
      expect(result.url).toContain(repository)
    }
  })
})

describe('decideLiveIssue', () => {
  const detailed =
    'Steps to reproduce: call the refresh endpoint twice. Running Node 20.1 on Ubuntu 22.04 with version 2.4.0 of the client library installed locally.'

  it('reports insufficient evidence when nothing corroborates the report', () => {
    const { insight } = decideLiveIssue({
      issue: issue({ number: 5, title: 'Something feels slow', body: detailed }),
      matches: [],
      repository,
    })
    expect(insight.insufficientEvidence).toBe(true)
    expect(insight.confidence).toBeLessThanOrEqual(0.44)
    expect(insight.decision).toBe('silent')
  })

  it('calls a near-identical report a duplicate and proposes a link', () => {
    const target = issue({ number: 10, title: 'Refresh token rotation fails', subsystem: 'authentication', body: detailed })
    const corpus = [issue({ number: 11, title: 'Refresh token rotation fails', subsystem: 'authentication', body: detailed })]
    const matches = searchLiveIssues({ target, corpus, repository })

    const { insight, approval } = decideLiveIssue({ issue: target, matches, repository })
    expect(insight.decision).toBe('duplicate')
    expect(approval?.kind).toBe('link_issue')
    // Consequential actions stay proposals until a maintainer approves.
    expect(approval?.status).toBe('proposed')
  })

  it('escalates security-sensitive language and proposes a label', () => {
    const { insight, approval } = decideLiveIssue({
      issue: issue({ number: 7, title: 'SQL injection in search endpoint', body: detailed }),
      matches: [],
      repository,
    })
    expect(insight.decision).toBe('escalate')
    expect(approval?.kind).toBe('add_label')
    // Keyword matching must not masquerade as certainty.
    expect(insight.confidence).toBeLessThanOrEqual(0.78)
  })

  it('asks for missing details instead of escalating a thin report', () => {
    const { insight, approval } = decideLiveIssue({
      issue: issue({ number: 8, title: 'It broke', body: 'does not work' }),
      matches: [],
      repository,
    })
    expect(insight.decision).toBe('follow_up')
    expect(insight.factors.some((factor) => factor.startsWith('Missing'))).toBe(true)
    expect(approval?.kind).toBe('request_information')
  })

  it('never claims confidence above the honest ceiling for any decision', () => {
    const cases: IssueRecord[] = [
      issue({ number: 1, title: 'SQL injection', body: detailed }),
      issue({ number: 2, title: 'It broke', body: 'nope' }),
      issue({ number: 3, title: 'Regression after upgrading auth', body: detailed, subsystem: 'authentication' }),
    ]
    for (const candidate of cases) {
      const { insight } = decideLiveIssue({ issue: candidate, matches: [], repository })
      expect(insight.confidence).toBeGreaterThan(0)
      expect(insight.confidence).toBeLessThanOrEqual(1)
      // Section 27: an insight with no evidence must say so explicitly.
      if (insight.evidence.length === 0 && !insight.insufficientEvidence) {
        expect(['escalate', 'follow_up']).toContain(insight.decision)
      }
    }
  })
})

/**
 * Parsing against payloads shaped exactly like GitHub's REST responses,
 * including the fields that broke naive parsers: a null body, PR entries mixed
 * into /issues, and labels arriving as objects rather than strings.
 */
describe('live pipeline on GitHub-shaped payloads', () => {
  const raw = [
    {
      number: 5678,
      title: 'Session cookie not refreshed after login, breaks after upgrading to 3.1',
      body: 'Steps to reproduce:\n1. Log in\n2. Wait for the session to expire\n\nThe refresh token expires and the user is logged out unexpectedly. This used to work before. Running Python 3.12 on Ubuntu 24.04 with version 3.1.0.',
      labels: [{ name: 'bug' }, { name: 'auth' }],
      state: 'open',
      created_at: '2026-02-01T10:00:00Z',
      updated_at: '2026-02-03T12:00:00Z',
      comments: 4,
    },
    {
      number: 5601,
      title: 'Rotation of credentials drops the active user context',
      body: 'When credentials rotate the active user context is discarded midway. Steps to reproduce are in the linked gist. Running Python 3.12 on Ubuntu 24.04, version 3.0.2.',
      labels: [{ name: 'bug' }, { name: 'auth' }],
      state: 'closed',
      created_at: '2026-01-04T10:00:00Z',
      updated_at: '2026-01-09T12:00:00Z',
      comments: 7,
    },
    {
      number: 5590,
      title: 'Update contributing guide',
      body: 'Small documentation fix for the readme.',
      labels: [{ name: 'docs' }],
      state: 'open',
      created_at: '2026-01-02T10:00:00Z',
      updated_at: '2026-01-02T10:00:00Z',
      comments: 0,
    },
  ]

  it('excludes pull requests from an /issues payload', () => {
    const mixed = [...raw, { ...raw[2], number: 5599, pull_request: { url: 'https://api.github.com/…' } }]
    const issues = mixed.filter((item) => !('pull_request' in item)).map(toIssueRecord)
    expect(issues.map((item) => item.number)).not.toContain(5599)
    expect(issues).toHaveLength(3)
  })

  it('escalates a corroborated regression with real-world text', () => {
    const corpus = raw.map(toIssueRecord)
    const target = corpus[0]
    const matches = searchLiveIssues({ target, corpus, repository })
    const { insight } = decideLiveIssue({ issue: target, matches, repository })

    expect(target.subsystem).toBe('authentication')
    expect(matches[0]?.id).toBe('#5601')
    // Corroborated but not the same report, so this escalates rather than
    // being folded into a duplicate.
    expect(insight.decision).toBe('escalate')
    expect(insight.evidence.length).toBeGreaterThan(0)
    // Section 27: an escalation must be able to point at its evidence.
    expect(insight.factors.join(' ')).toContain('Regression')
  })

  it('does not tie an unrelated docs issue to the auth cluster', () => {
    const corpus = raw.map(toIssueRecord)
    const docs = corpus[2]
    const matches = searchLiveIssues({ target: docs, corpus, repository })
    expect(matches.map((match) => match.id)).not.toContain('#5601')
  })
})

/**
 * Regressions found by running against a real repository (aryabailur/Doombot).
 *
 * Two failures showed up that the fixture tests missed: near-identical short
 * titles scored below the duplicate threshold, and a thin stub issue outranked
 * a credential leak in the attention list.
 */
describe('ranking regressions from live data', () => {
  const doombot = [
    { number: 6, title: 'Login broken with 401 after v2.1 upgrade', body: 'After upgrading to v2.1 login returns 401.', labels: [{ name: 'bug' }], state: 'open', created_at: '', updated_at: '', comments: 0 },
    { number: 4, title: 'Cannot authenticate after v2.1 update - API_KEY exposed in traceback', body: 'Since updating to v2.1 I get a 401 with the correct password. Worse, the stack trace prints the raw API_KEY value to stdout. This leaks a credential into any log that captures stdout.', labels: [{ name: 'bug' }, { name: 'security' }], state: 'open', created_at: '', updated_at: '', comments: 2 },
    { number: 3, title: 'Login fails with 401 after upgrading to v2.1', body: 'Upgraded to v2.1, now login fails with a 401 error.', labels: [{ name: 'bug' }], state: 'open', created_at: '', updated_at: '', comments: 0 },
    { number: 2, title: 'Doombot write-access check', body: 'Checking whether the bot can write.', labels: [], state: 'open', created_at: '', updated_at: '', comments: 0 },
  ]

  it('detects differently worded reports of the same bug as duplicates', () => {
    const corpus = doombot.map(toIssueRecord)
    const target = corpus[0] // "Login broken with 401..."
    const matches = searchLiveIssues({ target, corpus, repository })
    const { insight } = decideLiveIssue({ issue: target, matches, repository })

    // "broken" vs "fails", "upgrade" vs "upgrading" — same bug, different words.
    expect(matches[0].id).toBe('#3')
    expect(insight.decision).toBe('duplicate')
  })

  it('never reports a similarity of 1.0 after synonym folding', () => {
    const corpus = doombot.map(toIssueRecord)
    for (const target of corpus) {
      for (const match of searchLiveIssues({ target, corpus, repository })) {
        expect(match.score).toBeLessThan(1)
      }
    }
  })

  it('ranks a security escalation above a thin follow-up', () => {
    const corpus = doombot.map(toIssueRecord)
    const decisionFor = (target: (typeof corpus)[number]) =>
      decideLiveIssue({
        issue: target,
        matches: searchLiveIssues({ target, corpus, repository }),
        repository,
      }).insight

    const leak = decisionFor(corpus[1]) // API_KEY exposed
    const stub = decisionFor(corpus[3]) // write-access check

    expect(leak.decision).toBe('escalate')
    expect(stub.decision).toBe('follow_up')
    // A confident "this is thin" must not outrank a credential leak.
    expect(stub.confidence).toBeLessThan(leak.confidence)
  })
})
