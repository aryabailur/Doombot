import type { GitHubContext } from '@/lib/types'

import { detectGitHubContext } from './githubContext'

type ContextListener = (context: GitHubContext) => void

export function observeGitHubContext(listener: ContextListener): () => void {
  let currentHref = location.href
  let timer: ReturnType<typeof setTimeout> | undefined

  const notifyIfChanged = () => {
    if (location.href === currentHref) return
    currentHref = location.href
    listener(detectGitHubContext(location))
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(notifyIfChanged, 120)
  }

  const originalPushState = history.pushState.bind(history)
  const originalReplaceState = history.replaceState.bind(history)

  history.pushState = (...args) => {
    originalPushState(...args)
    schedule()
  }
  history.replaceState = (...args) => {
    originalReplaceState(...args)
    schedule()
  }

  addEventListener('popstate', schedule)
  addEventListener('turbo:load', schedule)
  addEventListener('pjax:end', schedule)

  const observer = new MutationObserver(schedule)
  observer.observe(document.head ?? document.documentElement, {
    characterData: true,
    childList: true,
    subtree: true,
  })

  const navigationApi = (window as Window & { navigation?: EventTarget }).navigation
  navigationApi?.addEventListener('navigatesuccess', schedule)

  return () => {
    clearTimeout(timer)
    observer.disconnect()
    removeEventListener('popstate', schedule)
    removeEventListener('turbo:load', schedule)
    removeEventListener('pjax:end', schedule)
    navigationApi?.removeEventListener('navigatesuccess', schedule)
    history.pushState = originalPushState
    history.replaceState = originalReplaceState
  }
}
