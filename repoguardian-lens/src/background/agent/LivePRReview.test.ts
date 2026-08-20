import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubClient } from './GitHubClient'
import { LiveAgentEngine } from './LiveAgentEngine'

afterEach(() => { GitHubClient.clearCache(); vi.unstubAllGlobals() })

describe('live PR review', () => {
  it('derives risk from real changed files and repository history', async () => {
    const issues = [
      { number: 10, title: 'OAuth token refresh fails', body: 'Token refresh returns 401 after rotation. Steps included, Node 20, version 2.1.', labels: [{name:'bug'}], state:'open', created_at:'', updated_at:'', comments:1 },
      { number: 11, title: 'Session expires during auth handshake', body: 'The auth session expires mid-handshake. Repro steps attached, Node 20, v2.1.', labels: [{name:'bug'}], state:'closed', created_at:'', updated_at:'', comments:3 },
      { number: 12, title: 'Docs typo', body: 'readme typo', labels: [], state:'open', created_at:'', updated_at:'', comments:0 },
    ]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const p = new URL(url).pathname + new URL(url).search
      const body = p.includes('/issues?') ? issues
        : p.includes('/pulls/7/files') ? [{ filename: 'src/auth/token.ts' }, { filename: 'src/auth/refresh.ts' }]
        : p.includes('/pulls/7') ? { number: 7, title: 'Refactor OAuth token rotation', body: 'Rework rotation' }
        : {}
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const review = await new LiveAgentEngine().reviewPullRequest({ owner: 'o', repo: 'r', pullNumber: 7 })
    console.log('PR:', review.pullRequest.number, review.pullRequest.title)
    console.log('subsystem:', review.pullRequest.subsystem)
    console.log('risk:', review.risk, 'confidence:', review.confidence)
    console.log('summary:', review.summary)
    console.log('path:', review.path)
    console.log('evidence:', review.evidence.map(e => `${e.id}@${e.score}`))

    expect(review.pullRequest.subsystem).toBe('authentication')
    // The regression path must be the real changed files, not an invented chain.
    expect(review.path).toEqual(['src/auth/token.ts', 'src/auth/refresh.ts'])
    expect(review.confidence).toBeLessThanOrEqual(0.82)
  })
})
