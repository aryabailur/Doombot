import type { ExtensionMessage } from '@/lib/types'

import { MockAgentEngine } from './agent/MockAgentEngine'
import { routeMessage } from './messageRouter'

const engine = new MockAgentEngine()

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
