import type { ApprovalAction, DecisionFeedback, DemoState } from './types'

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
