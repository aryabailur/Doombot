import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEngine } from './agent/AgentEngine'
import { GitHubClient } from './agent/GitHubClient'
import { routeMessage } from './messageRouter'

afterEach(() => {
  GitHubClient.clearCache()
  vi.unstubAllGlobals()
})

describe('messageRouter live-source isolation', () => {
  it('refuses Fix Lab when no live backend is configured', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({
            'repoguardian.settings': { demoMode: false },
          })),
        },
      },
    })

    const response = await routeMessage(
      { type: 'START_FIX_RUN', investigationId: 'inv-1' },
      {} as AgentEngine,
    )

    expect(response).toEqual({
      ok: false,
      error: 'A configured RepoGuardian backend is required to generate and verify a candidate fix.',
      recoverable: true,
    })
  })

  it('returns an honest live error instead of seeded fallback data', async () => {
    const seededActivity = vi.fn()
    const fallback = { getActivity: seededActivity } as unknown as AgentEngine
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({
            'repoguardian.settings': { demoMode: false },
          })),
        },
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline')
    }))

    const response = await routeMessage(
      { type: 'GET_ACTIVITY', owner: 'octocat', repo: 'example' },
      fallback,
    )

    expect(response).toMatchObject({
      ok: false,
      error: 'GitHub is unreachable.',
      recoverable: true,
    })
    expect(seededActivity).not.toHaveBeenCalled()
  })
})
