import { describe, expect, it } from 'vitest'

import { detectGitHubContext } from './githubContext'

function locationFor(url: string): Location {
  const value = new URL(url)
  return { hostname: value.hostname, pathname: value.pathname } as Location
}

describe('detectGitHubContext', () => {
  it('detects repository pages and repository subpaths', () => {
    expect(detectGitHubContext(locationFor('https://github.com/acme/payments-api'))).toEqual({
      type: 'repository',
      owner: 'acme',
      repo: 'payments-api',
    })
    expect(detectGitHubContext(locationFor('https://github.com/acme/payments-api/tree/main/src'))).toEqual({
      type: 'repository',
      owner: 'acme',
      repo: 'payments-api',
    })
  })

  it('detects issue and pull-request pages', () => {
    expect(detectGitHubContext(locationFor('https://github.com/acme/payments-api/issues/482'))).toEqual({
      type: 'issue',
      owner: 'acme',
      repo: 'payments-api',
      issueNumber: 482,
    })
    expect(detectGitHubContext(locationFor('https://github.com/acme/payments-api/pull/201/files'))).toEqual({
      type: 'pull_request',
      owner: 'acme',
      repo: 'payments-api',
      pullNumber: 201,
    })
  })

  it('rejects non-repository and non-GitHub locations', () => {
    expect(detectGitHubContext(locationFor('https://github.com/settings/profile'))).toEqual({ type: 'unknown' })
    expect(detectGitHubContext(locationFor('https://example.com/acme/payments-api'))).toEqual({ type: 'unknown' })
  })
})
