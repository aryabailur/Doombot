import type { ExtensionMessage } from '@/lib/types'

import { readSettings } from '@/lib/storage'
import { MockAgentEngine } from './agent/MockAgentEngine'
import { monitor, routeMessage } from './messageRouter'

const engine = new MockAgentEngine()

/**
 * Subscribe to the agent as soon as the worker wakes.
 *
 * Connecting here rather than when the panel opens is the point: the agent's
 * autonomous monitoring runs whether or not anyone is looking, and its
 * activity should already be in the buffer when the Lens is first opened.
 */
async function connectAgentFeed(): Promise<void> {
  const settings = await readSettings()
  if (!settings.demoMode && settings.backendUrl) {
    monitor.connect(settings.backendUrl)
  }
}

void connectAgentFeed()

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: '#8B5CF6' })
  void chrome.action.setBadgeText({ text: 'RG' })
})

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: unknown) => void) => {
    void routeMessage(message, engine).then(sendResponse)
    return true
  },
)

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return
  void chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_LENS' } satisfies ExtensionMessage).catch(() => {
    void chrome.action.setBadgeBackgroundColor({ color: '#FB923C' })
    void chrome.action.setBadgeText({ text: '!' })
  })
})
