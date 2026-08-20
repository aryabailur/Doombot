import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitHubClient } from './GitHubClient'
import { LiveAgentEngine } from './LiveAgentEngine'

/**
 * Guards the unauthenticated request budget (60/hour).
 *
 * A full panel load must stay well inside it, or the extension bricks itself
 * after one or two page views.
 */
afterEach(() => {
  GitHubClient.clearCache()
  vi.unstubAllGlobals()
})

function stubGitHub() {
  const paths: string[] = []
  const issues = Array.from({ length: 60 }, (_, index) => ({
    number: index + 1,
    title: `Issue ${index + 1} about auth tokens failing`,
    body: 'Steps to reproduce included. Running Node 20 on Ubuntu 22.04, version 1.2.3.',
    labels: [{ name: 'bug' }],
    state: 'open',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    comments: 1,
  }))

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(url).pathname + (new URL(url).search || '')
    paths.push(path)
    const body = path.includes('/issues?')
      ? issues
      : path.includes('/pulls?')
        ? [{ number: 1, title: 'PR', state: 'open', created_at: '', merged_at: null }]
        : path.includes('/contributors')
          ? [{ login: 'a', contributions: 5 }]
          : /\/issues\/\d+$/.test(path)
            ? issues[0]
            : { open_issues_count: 60, default_branch: 'main', pushed_at: '2026-01-01T00:00:00Z', stargazers_count: 3 }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))

  return { paths }
}

describe('live request budget', () => {
  it('loads a full issue page well inside the anonymous limit', async () => {
    const { paths } = stubGitHub()
    const engine = new LiveAgentEngine()
    const target = { owner: 'octocat', repo: 'example' }

    // Exactly what the panel requests when opening on an issue page.
    await Promise.all([
      engine.getRepositoryContext(target),
      engine.getRepositoryHealth(target),
      engine.getActivity(target),
    ])
    await engine.investigateIssue({ ...target, issueNumber: 1 })

    expect(paths.length).toBeLessThanOrEqual(6)
  })

  it('does not issue one request per issue when building the attention list', async () => {
    const { paths } = stubGitHub()
    await new LiveAgentEngine().getActivity({ owner: 'octocat', repo: 'example' })
    // Ranking 25 issues must reuse the listing, not fetch each one.
    expect(paths.filter((path) => /\/issues\/\d+$/.test(path))).toHaveLength(0)
    expect(paths.length).toBeLessThanOrEqual(2)
  })
})
