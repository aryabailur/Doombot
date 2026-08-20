import { create } from 'zustand'

import type {
  ActivitySummary,
  ApprovalAction,
  DecisionFeedback,
  DuplicateResult,
  ExtensionMessage,
  ExtensionResponse,
  GitHubContext,
  GroundedAnswer,
  HealthReport,
  Insight,
  Investigation,
  AgentActivityEvent,
  LensSettings,
  LensView,
  PRReview,
  RepositoryContext,
  RepositoryMemory,
} from '@/lib/types'

type AgentStatus = 'online' | 'investigating' | 'complete' | 'attention'

type LensState = {
  isOpen: boolean
  demoMode: boolean
  context: GitHubContext
  view: LensView
  status: AgentStatus
  repository?: RepositoryContext
  health?: HealthReport
  activity?: ActivitySummary
  insight?: Insight
  investigation?: Investigation
  duplicates: DuplicateResult[]
  prReview?: PRReview
  memory?: RepositoryMemory
  answer?: GroundedAnswer
  agentEvents: AgentActivityEvent[]
  agentConnected: boolean
  /** True when a backend origin is set, i.e. autonomous monitoring is reachable. */
  backendConfigured: boolean
  loading: string | null
  error: string | null
  /** Set when a live request succeeded only by falling back to seeded data. */
  notice: string | null
  toggle: () => void
  close: () => void
  setView: (view: LensView) => void
  setDemoMode: (enabled: boolean) => Promise<void>
  initialize: (context: GitHubContext) => Promise<void>
  runInvestigation: () => Promise<void>
  loadMemory: () => Promise<void>
  refreshAgentFeed: () => Promise<void>
  loadDuplicates: () => Promise<void>
  ask: (question: string) => Promise<void>
  decideApproval: (action: ApprovalAction, approved: boolean) => Promise<void>
  recordFeedback: (feedback: DecisionFeedback) => Promise<void>
  resetDemo: () => Promise<void>
}

/**
 * Last degradation notice seen by send(). Read immediately after an await, so
 * a module-level slot is enough and avoids threading it through every call.
 */
let lastNotice: string | null = null

async function send<T>(message: ExtensionMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  if (response.degraded && response.notice) lastNotice = response.notice
  return response.data
}

function repositoryCoordinates(context: GitHubContext): { owner: string; repo: string } {
  return context.type === 'unknown'
    ? { owner: 'acme', repo: 'payments-api' }
    : { owner: context.owner, repo: context.repo }
}

export const useLensStore = create<LensState>((set, get) => ({
  isOpen: false,
  demoMode: true,
  context: { type: 'unknown' },
  view: 'overview',
  status: 'online',
  duplicates: [],
  agentEvents: [],
  agentConnected: false,
  backendConfigured: false,
  loading: null,
  error: null,
  notice: null,

  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  close: () => set({ isOpen: false }),
  setView: (view) => set({ view }),
  setDemoMode: async (enabled) => {
    set({ demoMode: enabled, error: null })
    // Persisted in the service worker, which is what actually selects the
    // engine -- the panel's flag alone would change nothing.
    await send({ type: 'SET_SETTINGS', settings: { demoMode: enabled } })
    await get().initialize(get().context)
  },

  initialize: async (context) => {
    // The service worker owns the mode; read it back so a reopened panel does
    // not show "Demo" while live requests are being served, or the reverse.
    try {
      const settings = await send<LensSettings>({ type: 'GET_SETTINGS' })
      set({ demoMode: settings.demoMode, backendConfigured: Boolean(settings.backendUrl) })
    } catch {
      // Storage unavailable: keep the safe demo default.
    }
    const coordinates = repositoryCoordinates(context)
    set({
      context,
      loading: 'Retrieving project memory',
      error: null,
      notice: null,
      view: context.type === 'pull_request' ? 'pr' : 'overview',
      investigation: undefined,
      duplicates: [],
      answer: undefined,
    })
    lastNotice = null
    try {
      const [repository, health, activity] = await Promise.all([
        send<RepositoryContext>({ type: 'GET_REPOSITORY_CONTEXT', ...coordinates }),
        send<HealthReport>({ type: 'GET_HEALTH', ...coordinates }),
        send<ActivitySummary>({ type: 'GET_ACTIVITY', ...coordinates }),
      ])
      const investigation =
        context.type === 'issue'
          ? await send<Investigation>({ type: 'RUN_INVESTIGATION', ...coordinates, issueNumber: context.issueNumber })
          : undefined
      const insight = investigation?.insight
      const prReview =
        context.type === 'pull_request'
          ? await send<PRReview>({ type: 'GET_PR_REVIEW', ...coordinates, pullNumber: context.pullNumber })
          : undefined
      set({
        repository,
        health,
        activity,
        insight,
        investigation,
        prReview,
        loading: null,
        status: 'online',
        notice: lastNotice,
      })
    } catch (error) {
      set({
        loading: null,
        error: error instanceof Error ? error.message : 'RepoGuardian could not load repository context.',
      })
    }
  },

  runInvestigation: async () => {
    const { context } = get()
    if (context.type !== 'issue') return
    set({ status: 'investigating', loading: 'Searching project history', error: null, view: 'investigation' })
    try {
      const investigation = await send<Investigation>({
        type: 'RUN_INVESTIGATION',
        owner: context.owner,
        repo: context.repo,
        issueNumber: context.issueNumber,
      })
      set({ investigation, insight: investigation.insight, loading: null, status: 'investigating' })
    } catch (error) {
      set({
        loading: null,
        status: 'attention',
        error: error instanceof Error ? error.message : 'The investigation could not complete.',
      })
    }
  },

  refreshAgentFeed: async () => {
    try {
      const feed = await send<{ connected: boolean; events: AgentActivityEvent[] }>({
        type: 'GET_AGENT_ACTIVITY',
      })
      set({ agentEvents: feed.events, agentConnected: feed.connected })
    } catch {
      // The worker may be asleep; the next poll picks it up.
      set({ agentConnected: false })
    }
  },

  loadMemory: async () => {
    const coordinates = repositoryCoordinates(get().context)
    set({ loading: 'Retrieving project memory', view: 'memory', error: null })
    try {
      const memory = await send<RepositoryMemory>({ type: 'GET_REPOSITORY_MEMORY', ...coordinates })
      set({ memory, loading: null })
    } catch (error) {
      set({ loading: null, error: error instanceof Error ? error.message : 'Project memory is unavailable.' })
    }
  },

  loadDuplicates: async () => {
    const { context } = get()
    if (context.type !== 'issue') return
    set({ loading: 'Comparing historical cases', error: null })
    try {
      const duplicates = await send<DuplicateResult[]>({
        type: 'GET_DUPLICATES',
        owner: context.owner,
        repo: context.repo,
        issueNumber: context.issueNumber,
      })
      set({ duplicates, loading: null })
    } catch (error) {
      set({ loading: null, error: error instanceof Error ? error.message : 'Duplicate comparison failed.' })
    }
  },

  ask: async (question) => {
    const { context } = get()
    const coordinates = repositoryCoordinates(context)
    set({ loading: 'Searching repository memory', error: null, view: 'ask' })
    try {
      const answer = await send<GroundedAnswer>({
        type: 'ASK_AGENT',
        ...coordinates,
        question,
        context,
      })
      set({ answer, loading: null })
    } catch (error) {
      set({ loading: null, error: error instanceof Error ? error.message : 'RepoGuardian could not answer that question.' })
    }
  },

  decideApproval: async (action, approved) => {
    try {
      await send({ type: 'APPROVE_ACTION', action, approved })
      set((state) => ({
        investigation: state.investigation
          ? {
              ...state.investigation,
              approval: { ...action, status: approved ? 'approved' : 'rejected' },
            }
          : state.investigation,
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'The approval decision could not be stored.' })
    }
  },

  recordFeedback: async (feedback) => {
    try {
      await send({ type: 'RECORD_FEEDBACK', feedback })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Feedback could not be stored.' })
    }
  },

  resetDemo: async () => {
    set({ loading: 'Resetting demo', error: null })
    try {
      await send({ type: 'RESET_DEMO' })
      const context = get().context
      set({ investigation: undefined, answer: undefined, duplicates: [], loading: null })
      await get().initialize(context)
    } catch (error) {
      set({ loading: null, error: error instanceof Error ? error.message : 'Demo reset failed.' })
    }
  },
}))

/**
 * Analyse an arbitrary repository for the X-ray panel.
 *
 * Separate from the store because it targets a repository the user typed in
 * rather than the one on screen, so it must not overwrite panel state.
 */
export async function analyzeRepository(
  owner: string,
  repo: string,
): Promise<{ health: HealthReport; memory: RepositoryMemory }> {
  const [health, memory] = await Promise.all([
    send<HealthReport>({ type: 'GET_HEALTH', owner, repo }),
    send<RepositoryMemory>({ type: 'GET_REPOSITORY_MEMORY', owner, repo }),
  ])
  return { health, memory }
}
