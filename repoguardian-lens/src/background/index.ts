import type { AgentActivityEvent, ExtensionMessage } from '@/lib/types'

import { readSettings } from '@/lib/storage'
import { MockAgentEngine } from './agent/MockAgentEngine'
import { monitor, routeMessage } from './messageRouter'

const engine = new MockAgentEngine()

const AGENT_SESSION_KEY = 'repoguardian.agentSession'

type AgentSession = {
  events: AgentActivityEvent[]
  unreadEscalations: number
}

let unreadEscalations = 0

async function readAgentSession(): Promise<AgentSession> {
  const stored = await chrome.storage.session.get(AGENT_SESSION_KEY)
  return (
    (stored[AGENT_SESSION_KEY] as AgentSession | undefined) ?? {
      events: [],
      unreadEscalations: 0,
    }
  )
}

async function updateBadge(): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: '#F43F5E' })
  await chrome.action.setBadgeText({
    text: unreadEscalations > 0 ? String(Math.min(unreadEscalations, 99)) : '',
  })
}

async function persistAgentSession(events: AgentActivityEvent[]): Promise<void> {
  await chrome.storage.session.set({
    [AGENT_SESSION_KEY]: { events, unreadEscalations } satisfies AgentSession,
  })
}

async function markAgentActivityRead(): Promise<void> {
  unreadEscalations = 0
  await updateBadge()
  await persistAgentSession(monitor.snapshot().reverse())
}

monitor.subscribe((event, snapshot) => {
  const escalated = event.kind === 'decision' && event.severity === 'warning'
  if (escalated) unreadEscalations += 1

  void persistAgentSession([...snapshot].reverse())
  if (!escalated) return

  void updateBadge()
  void chrome.notifications.create(event.id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'RepoGuardian needs your attention',
    message: event.repository
      ? `${event.repository}: ${event.message}`
      : event.message,
    priority: 2,
  })
})

/**
 * Subscribe to the agent as soon as the worker wakes.
 *
 * Connecting here rather than when the panel opens is the point: the agent's
 * autonomous monitoring runs whether or not anyone is looking, and its
 * activity should already be in the buffer when the Lens is first opened.
 */
async function connectAgentFeed(): Promise<void> {
  const session = await readAgentSession()
  unreadEscalations = session.unreadEscalations
  monitor.restore(session.events)
  await updateBadge()

  const settings = await readSettings()
  if (!settings.demoMode && settings.backendUrl) {
    monitor.connect(settings.backendUrl)
  }
}

void connectAgentFeed()

chrome.runtime.onInstalled.addListener(() => {
  void updateBadge()
})

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: unknown) => void) => {
    void routeMessage(message, engine).then(async (response) => {
      if (message.type === 'GET_AGENT_ACTIVITY') await markAgentActivityRead()
      sendResponse(response)
    })
    return true
  },
)

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return
  void markAgentActivityRead()
  void chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_LENS' } satisfies ExtensionMessage).catch(() => {
    void chrome.action.setBadgeBackgroundColor({ color: '#FB923C' })
    void chrome.action.setBadgeText({ text: '!' })
  })
})

chrome.notifications.onClicked.addListener((notificationId) => {
  const event = monitor.snapshot().find((candidate) => candidate.id === notificationId)
  void chrome.notifications.clear(notificationId)
  void markAgentActivityRead()
  if (!event?.repository) return

  const repositoryPath = event.repository
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  void chrome.tabs.create({ url: `https://github.com/${repositoryPath}` })
})
