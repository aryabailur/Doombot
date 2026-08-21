import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExtensionMessage } from '@/lib/types'
import { useLensStore } from './useLensStore'

function responseFor(message: ExtensionMessage) {
  switch (message.type) {
    case 'GET_SETTINGS':
      return { ok: true, data: { demoMode: true } }
    case 'RUN_INVESTIGATION':
      return { ok: true, data: { insight: undefined } }
    default:
      return { ok: true, data: {} }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useLensStore issue safety', () => {
  it('loads issue context without starting an investigation', async () => {
    const sendMessage = vi.fn(async (message: ExtensionMessage) => responseFor(message))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await useLensStore.getState().initialize({
      type: 'issue',
      owner: 'acme',
      repo: 'payments-api',
      issueNumber: 42,
    })

    const messageTypes = sendMessage.mock.calls.map(([message]) => message.type)
    expect(messageTypes).toEqual([
      'GET_SETTINGS',
      'GET_REPOSITORY_CONTEXT',
      'GET_HEALTH',
      'GET_ACTIVITY',
    ])
    expect(messageTypes).not.toContain('RUN_INVESTIGATION')
    expect(useLensStore.getState().view).toBe('investigation')
    expect(useLensStore.getState().investigation).toBeUndefined()
  })

  it('starts an investigation only after the explicit action', async () => {
    const sendMessage = vi.fn(async (message: ExtensionMessage) => responseFor(message))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    useLensStore.setState({
      context: {
        type: 'issue',
        owner: 'acme',
        repo: 'payments-api',
        issueNumber: 42,
      },
    })

    await useLensStore.getState().runInvestigation()

    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage.mock.calls[0][0]).toEqual({
      type: 'RUN_INVESTIGATION',
      owner: 'acme',
      repo: 'payments-api',
      issueNumber: 42,
    })
  })

  it('coalesces repeated clicks while an investigation is running', async () => {
    let finish: ((value: { ok: true; data: { insight: undefined } }) => void) | undefined
    const sendMessage = vi.fn((message: ExtensionMessage) => {
      if (message.type !== 'RUN_INVESTIGATION') return Promise.resolve(responseFor(message))
      return new Promise<{ ok: true; data: { insight: undefined } }>((resolve) => {
        finish = resolve
      })
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    useLensStore.setState({
      context: {
        type: 'issue',
        owner: 'acme',
        repo: 'payments-api',
        issueNumber: 42,
      },
      loading: null,
    })

    const first = useLensStore.getState().runInvestigation()
    const repeated = useLensStore.getState().runInvestigation()

    expect(sendMessage).toHaveBeenCalledOnce()
    finish?.({ ok: true, data: { insight: undefined } })
    await Promise.all([first, repeated])
  })

  it('starts and reviews a persisted Fix Lab run only after explicit actions', async () => {
    const candidate = {
      id: 'fix-1',
      investigationId: 'inv-1',
      repository: 'acme/payments-api',
      issueNumber: 42,
      status: 'proposed' as const,
      summary: 'Fix the regression.',
      patch: 'diff --git a/src/app.py b/src/app.py\n',
      commands: [['python', '-m', 'pytest', '-q']],
      receipts: [{
        command: ['python', '-m', 'pytest', '-q'],
        exitCode: 0,
        durationMs: 12,
        stdout: 'passed',
        stderr: '',
        containerized: true,
        networkDisabled: true,
        image: 'repoguardian-fixlab-python:local',
        imageDigest: 'sha256:abc123',
      }],
    }
    const sendMessage = vi.fn(async (message: ExtensionMessage) => {
      if (message.type === 'START_FIX_RUN') return { ok: true, data: candidate }
      if (message.type === 'DECIDE_FIX_RUN') {
        return { ok: true, data: { ...candidate, status: 'approved' as const } }
      }
      return responseFor(message)
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    useLensStore.setState({
      investigation: { runId: 'inv-1' } as never,
      fixRun: undefined,
      loading: null,
    })

    await useLensStore.getState().startFixRun()
    expect(sendMessage.mock.calls[0][0]).toEqual({ type: 'START_FIX_RUN', investigationId: 'inv-1' })
    expect(useLensStore.getState().fixRun?.status).toBe('proposed')

    await useLensStore.getState().decideFixRun(true)
    expect(sendMessage.mock.calls[1][0]).toEqual({ type: 'DECIDE_FIX_RUN', runId: 'fix-1', approved: true })
    expect(useLensStore.getState().fixRun?.status).toBe('approved')
  })
})
