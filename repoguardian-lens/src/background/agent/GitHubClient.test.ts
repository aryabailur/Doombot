import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitHubClient, GitHubError } from './GitHubClient'

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

afterEach(() => {
  GitHubClient.clearCache()
  vi.unstubAllGlobals()
})

describe('GitHubClient request budget', () => {
  it('shares one request between concurrent callers for the same path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ open_issues_count: 5, default_branch: 'main', pushed_at: '2026-01-01T00:00:00Z', stargazers_count: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new GitHubClient()
    // The panel opens context, health, and activity in parallel; all three
    // read the same repo endpoint.
    await Promise.all([
      client.getRepo('octocat', 'example'),
      client.getRepo('octocat', 'example'),
      client.getRepo('octocat', 'example'),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so a retry can succeed', async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      if (call === 1) return jsonResponse({ message: 'boom' }, { status: 500 })
      return jsonResponse({ open_issues_count: 1, default_branch: 'main', pushed_at: '2026-01-01T00:00:00Z', stargazers_count: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new GitHubClient()
    await expect(client.getRepo('octocat', 'example')).rejects.toThrow(GitHubError)
    await expect(client.getRepo('octocat', 'example')).resolves.toMatchObject({ open_issues_count: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports an exhausted rate limit as a recoverable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ message: 'rate limited' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    ))

    await expect(new GitHubClient().getRepo('octocat', 'example')).rejects.toMatchObject({
      status: 403,
      recoverable: true,
    })
  })

  it('surfaces a network failure rather than hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(new GitHubClient().getRepo('octocat', 'example')).rejects.toMatchObject({ status: 0 })
  })

  it('filters pull requests out of the issues listing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse([
        { number: 1, title: 'Real issue', body: '', labels: [], state: 'open', created_at: '', updated_at: '', comments: 0 },
        { number: 2, title: 'A pull request', body: '', labels: [], state: 'open', created_at: '', updated_at: '', comments: 0, pull_request: { url: 'x' } },
      ]),
    ))

    const issues = await new GitHubClient().listIssues('octocat', 'example')
    expect(issues.map((issue) => issue.number)).toEqual([1])
  })

  it('sends no Authorization header when no token is configured', async () => {
    const seen: Array<Record<string, string>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push((init?.headers ?? {}) as Record<string, string>)
        return jsonResponse({ open_issues_count: 0, default_branch: 'main', pushed_at: '', stargazers_count: 0 })
      }),
    )

    await new GitHubClient().getRepo('octocat', 'example')
    expect(seen[0].Authorization).toBeUndefined()
  })

  it('sends a bearer token when one is configured', async () => {
    const seen: Array<Record<string, string>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push((init?.headers ?? {}) as Record<string, string>)
        return jsonResponse({ open_issues_count: 0, default_branch: 'main', pushed_at: '', stargazers_count: 0 })
      }),
    )

    await new GitHubClient('ghp_example').getRepo('octocat', 'example')
    expect(seen[0].Authorization).toBe('Bearer ghp_example')
  })
})

describe('commit count', () => {
  it('reads the total from the Link header last page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify([{ sha: 'abc' }]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          link: '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=1&page=847>; rel="last"',
        },
      }),
    ))

    await expect(new GitHubClient().countCommits('octocat', 'example')).resolves.toBe(847)
  })

  it('falls back to the page length when there is no Link header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify([{ sha: 'a' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))
    await expect(new GitHubClient().countCommits('octocat', 'example')).resolves.toBe(1)
  })

  it('returns 0 rather than throwing when commits are unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 409 })))
    // Empty repositories return 409; the memory panel should still render.
    await expect(new GitHubClient().countCommits('octocat', 'example')).resolves.toBe(0)
  })
})
