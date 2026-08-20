import type { ApprovalAction, DecisionFeedback, DemoState, LensSettings } from './types'

const DEMO_STATE_KEY = 'repoguardian.demoState'

const EMPTY_STATE: DemoState = {
  approvals: {},
  feedback: [],
}

function storageArea(): chrome.storage.StorageArea | undefined {
  return globalThis.chrome?.storage?.local
}

export async function readDemoState(): Promise<DemoState> {
  const area = storageArea()
  if (!area) return structuredClone(EMPTY_STATE)
  const stored = await area.get(DEMO_STATE_KEY)
  return (stored[DEMO_STATE_KEY] as DemoState | undefined) ?? structuredClone(EMPTY_STATE)
}

export async function saveApproval(action: ApprovalAction, approved: boolean): Promise<DemoState> {
  const state = await readDemoState()
  state.approvals[action.id] = approved ? 'approved' : 'rejected'
  await storageArea()?.set({ [DEMO_STATE_KEY]: state })
  return state
}

export async function saveFeedback(feedback: DecisionFeedback): Promise<DemoState> {
  const state = await readDemoState()
  state.feedback = [
    ...state.feedback.filter((item) => item.issueNumber !== feedback.issueNumber),
    feedback,
  ]
  await storageArea()?.set({ [DEMO_STATE_KEY]: state })
  return state
}

export async function resetDemoState(): Promise<DemoState> {
  const state = structuredClone(EMPTY_STATE)
  await storageArea()?.set({ [DEMO_STATE_KEY]: state })
  return state
}

const SETTINGS_KEY = 'repoguardian.settings'

export type { LensSettings }

const DEFAULT_SETTINGS: LensSettings = { demoMode: true }

export async function readSettings(): Promise<LensSettings> {
  const area = storageArea()
  if (!area) return { ...DEFAULT_SETTINGS }
  const stored = await area.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as LensSettings | undefined) }
}

export async function saveSettings(patch: Partial<LensSettings>): Promise<LensSettings> {
  const next = { ...(await readSettings()), ...patch }
  await storageArea()?.set({ [SETTINGS_KEY]: next })
  return next
}
