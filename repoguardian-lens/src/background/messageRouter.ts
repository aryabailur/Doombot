import type { ExtensionMessage, ExtensionResponse } from '@/lib/types'
import { readSettings, resetDemoState, saveApproval, saveFeedback, saveSettings } from '@/lib/storage'

import type { AgentEngine } from './agent/AgentEngine'
import { GitHubClient, GitHubError } from './agent/GitHubClient'
import { AgentMonitor } from './agent/AgentMonitor'
import { BackendAgentEngine } from './agent/BackendAgentEngine'
import { LiveAgentEngine } from './agent/LiveAgentEngine'

/**
 * Memoised in-flight and completed requests.
 *
 * The promise is stored, not the value: the panel opens context, health, and
 * activity in parallel, and each of those hits the same GitHub endpoints. If
 * only settled values were cached, three concurrent callers would all miss and
 * spend three times the rate-limit budget on identical requests.
 *
 * A rejected entry is evicted so a transient failure does not become sticky.
 */
type CacheEntry = {
  expiresAt: number
  value: Promise<unknown>
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL = {
  context: 5 * 60_000,
  activity: 15_000,
  health: 60_000,
  memory: 5 * 60_000,
}

/**
 * Live agent feed, shared for the worker's lifetime.
 *
 * Held at module scope so the socket survives across messages; the worker may
 * still be terminated, which is why the panel reads a snapshot rather than
 * assuming continuous delivery.
 */
export const monitor = new AgentMonitor()

/** Connect or disconnect the feed to match the current settings. */
async function syncMonitor(): Promise<void> {
  const settings = await readSettings()
  if (!settings.demoMode && settings.backendUrl) {
    monitor.connect(settings.backendUrl)
  } else {
    // Demo mode is offline by definition, and without a backend there is no
    // agent to listen to.
    monitor.disconnect()
  }
}

function cached<T>(key: string, factory: () => Promise<T>, ttlMs: number): Promise<T> {
  const existing = cache.get(key)
  if (existing && existing.expiresAt > Date.now()) return existing.value as Promise<T>
  if (existing) cache.delete(key)
  const pending = factory().catch((error: unknown) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, { expiresAt: Date.now() + ttlMs, value: pending })
  return pending as Promise<T>
}

/**
 * Which engine answers this request.
 *
 * Demo mode is the default and is fully offline. Live mode builds an engine per
 * call so a token added in options takes effect without a reload; the client's
 * own response cache keeps that from costing extra requests.
 */
async function resolveEngine(fallback: AgentEngine): Promise<{ engine: AgentEngine; live: boolean }> {
  const settings = await readSettings()
  if (settings.demoMode) return { engine: fallback, live: false }
  // A configured backend is the LLM-grade path; without one, live mode reads
  // GitHub directly. Both are "live" for fallback purposes.
  if (settings.backendUrl) {
    return {
      engine: new BackendAgentEngine(settings.backendUrl, settings.githubToken),
      live: true,
    }
  }
  return { engine: new LiveAgentEngine(settings.githubToken), live: true }
}

/**
 * Run one engine request without crossing data-source boundaries.
 *
 * Demo mode is seeded by definition. Live mode must never return those
 * fixtures: an unavailable backend or GitHub API is an honest error, not an
 * excuse to display convincing sample data under a LIVE badge.
 */
async function execute<T>(attempt: () => Promise<T>): Promise<ExtensionResponse<T>> {
  try {
    return { ok: true, data: await attempt() }
  } catch (error) {
    const reason =
      error instanceof GitHubError
        ? error.message
        : 'RepoGuardian could not retrieve current data.'
    return { ok: false, error: reason, recoverable: true }
  }
}

export async function routeMessage(
  message: ExtensionMessage,
  engine: AgentEngine,
): Promise<ExtensionResponse<unknown>> {
  try {
    const repository = 'owner' in message ? `${message.owner}/${message.repo}` : 'demo'
    const { engine: active, live } = await resolveEngine(engine)
    // Live results are keyed separately so toggling modes cannot serve a
    // seeded answer as if it were live, or the reverse.
    const scope = live ? 'live' : 'demo'

    switch (message.type) {
      case 'GET_REPOSITORY_CONTEXT':
        return await execute(() =>
          cached(
            `${scope}:context:${repository}`,
            () => active.getRepositoryContext(message),
            CACHE_TTL.context,
          ),
        )
      case 'GET_ISSUE_INSIGHT':
        return await execute(() => active.getIssueInsight(message))
      case 'RUN_INVESTIGATION':
        return await execute(() => active.investigateIssue(message))
      case 'GET_ACTIVITY':
        return await execute(() =>
          cached(
            `${scope}:activity:${repository}`,
            () => active.getActivity(message),
            CACHE_TTL.activity,
          ),
        )
      case 'GET_REPOSITORY_MEMORY':
        return await execute(() =>
          cached(
            `${scope}:memory:${repository}`,
            () => active.getRepositoryMemory(message),
            CACHE_TTL.memory,
          ),
        )
      case 'ASK_AGENT':
        return await execute(() => active.answerQuestion(message))
      case 'GET_DUPLICATES':
        return await execute(() => active.findDuplicates(message))
      case 'GET_PR_REVIEW':
        return await execute(() => active.reviewPullRequest(message))
      case 'GET_HEALTH':
        return await execute(() =>
          cached(
            `${scope}:health:${repository}`,
            () => active.getRepositoryHealth(message),
            CACHE_TTL.health,
          ),
        )
      case 'APPROVE_ACTION':
        if (live) {
          if (!active.decideAction) {
            return {
              ok: false,
              error: 'A configured RepoGuardian backend is required to execute approved GitHub actions.',
              recoverable: true,
            }
          }
          return await execute(() => active.decideAction!(message.action, message.approved))
        }
        await saveApproval(message.action, message.approved)
        return {
          ok: true,
          data: {
            ...message.action,
            status: message.approved ? 'approved' : 'rejected',
            live: false,
          },
        }
      case 'START_FIX_RUN':
        if (!live || !active.startFixRun) {
          return {
            ok: false,
            error: 'A configured RepoGuardian backend is required to generate and verify a candidate fix.',
            recoverable: true,
          }
        }
        return await execute(() => active.startFixRun!(message.investigationId))
      case 'DECIDE_FIX_RUN':
        if (!live || !active.decideFixRun) {
          return {
            ok: false,
            error: 'A configured RepoGuardian backend is required to review a candidate fix.',
            recoverable: true,
          }
        }
        return await execute(() => active.decideFixRun!(message.runId, message.approved))
      case 'RECORD_FEEDBACK':
        return { ok: true, data: await saveFeedback(message.feedback) }
      case 'GET_AGENT_ACTIVITY': {
        // Reconnect opportunistically: the worker may have been terminated
        // and restarted since the last message.
        await syncMonitor()
        const repository =
          message.owner && message.repo ? `${message.owner}/${message.repo}` : undefined
        return {
          ok: true,
          data: {
            connected: monitor.connected(),
            events: monitor.snapshot(repository),
          },
        }
      }
      case 'GET_SETTINGS':
        return { ok: true, data: await readSettings() }
      case 'SET_SETTINGS':
        // Mode and token both change what a request would return, so the
        // memoised results have to go with them.
        cache.clear()
        GitHubClient.clearCache()
        {
          const saved = await saveSettings(message.settings)
          // The feed follows the mode and backend URL.
          await syncMonitor()
          return { ok: true, data: saved }
        }
      case 'RESET_DEMO':
        cache.clear()
        GitHubClient.clearCache()
        return { ok: true, data: await resetDemoState() }
      case 'TOGGLE_LENS':
        return { ok: true, data: null }
    }
  } catch {
    return {
      ok: false,
      error: 'RepoGuardian could not complete that request. Demo data remains available.',
      recoverable: true,
    }
  }
}
