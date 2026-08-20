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
  loading: string | null
  error: string | null
  toggle: () => void
  close: () => void
  setView: (view: LensView) => void
  setDemoMode: (enabled: boolean) => void
  initialize: (context: GitHubContext) => Promise<void>
  runInvestigation: () => Promise<void>
  loadMemory: () => Promise<void>
  loadDuplicates: () => Promise<void>
  ask: (question: string) => Promise<void>
  decideApproval: (action: ApprovalAction, approved: boolean) => Promise<void>
  recordFeedback: (feedback: DecisionFeedback) => Promise<void>
  resetDemo: () => Promise<void>
}

async function send<T>(message: ExtensionMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
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
  loading: null,
  error: null,

  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  close: () => set({ isOpen: false }),
  setView: (view) => set({ view }),
  setDemoMode: (enabled) =>
    set({
      demoMode: enabled,
      error: enabled
        ? null
        : 'Live GitHub analysis needs a configured RepoGuardian backend. Demo repository data remains active.',
    }),

  initialize: async (context) => {
    const coordinates = repositoryCoordinates(context)
    set({
      context,
      loading: 'Retrieving project memory',
      error: null,
      view: context.type === 'pull_request' ? 'pr' : 'overview',
      investigation: undefined,
      duplicates: [],
      answer: undefined,
    })
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
      set({ repository, health, activity, insight, investigation, prReview, loading: null, status: 'online' })
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
