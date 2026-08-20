import type { ExtensionMessage, ExtensionResponse } from '@/lib/types'
import { resetDemoState, saveApproval, saveFeedback } from '@/lib/storage'

import type { AgentEngine } from './agent/AgentEngine'

const cache = new Map<string, unknown>()

async function cached<T>(key: string, factory: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T
  const value = await factory()
  cache.set(key, value)
  return value
}

export async function routeMessage(
  message: ExtensionMessage,
  engine: AgentEngine,
): Promise<ExtensionResponse<unknown>> {
  try {
    const repository = 'owner' in message ? `${message.owner}/${message.repo}` : 'demo'

    switch (message.type) {
      case 'GET_REPOSITORY_CONTEXT':
        return {
          ok: true,
          data: await cached(`context:${repository}`, () => engine.getRepositoryContext(message)),
        }
      case 'GET_ISSUE_INSIGHT':
        return { ok: true, data: await engine.getIssueInsight(message) }
      case 'RUN_INVESTIGATION':
        return { ok: true, data: await engine.investigateIssue(message) }
      case 'GET_ACTIVITY':
        return {
          ok: true,
          data: await cached(`activity:${repository}`, () => engine.getActivity(message)),
        }
      case 'GET_REPOSITORY_MEMORY':
        return {
          ok: true,
          data: await cached(`memory:${repository}`, () => engine.getRepositoryMemory(message)),
        }
      case 'ASK_AGENT':
        return { ok: true, data: await engine.answerQuestion(message) }
      case 'GET_DUPLICATES':
        return { ok: true, data: await engine.findDuplicates(message) }
      case 'GET_PR_REVIEW':
        return { ok: true, data: await engine.reviewPullRequest(message) }
      case 'GET_HEALTH':
        return {
          ok: true,
          data: await cached(`health:${repository}`, () => engine.getRepositoryHealth(message)),
        }
      case 'APPROVE_ACTION':
        return { ok: true, data: await saveApproval(message.action, message.approved) }
      case 'RECORD_FEEDBACK':
        return { ok: true, data: await saveFeedback(message.feedback) }
      case 'RESET_DEMO':
        cache.clear()
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
