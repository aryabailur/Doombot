import { Component, type ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { CommandPalette } from '@/components/CommandPalette'
import { LensPanel } from '@/components/LensPanel'
import { LensTrigger } from '@/components/LensTrigger'
import type { ExtensionMessage } from '@/lib/types'
import { useLensStore } from '@/store/useLensStore'
import lensCss from '@/styles/lens.css?inline'

import { detectGitHubContext } from './githubContext'
import { observeGitHubContext } from './githubObserver'

const HOST_ID = 'repoguardian-lens-host'

class LensErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // Deliberately avoid surfacing raw extension errors into the host page.
  }

  render() {
    if (this.state.failed) {
      return <div className="rg-fatal-fallback" role="alert"><strong>RepoGuardian Lens is available from the toolbar.</strong><span>The injected view could not start safely.</span></div>
    }
    return this.props.children
  }
}

function LensApp() {
  const { isOpen, status, activity, toggle, close, initialize, ask } = useLensStore()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    void initialize(detectGitHubContext(location))
    return observeGitHubContext((context) => void initialize(context))
  }, [initialize])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        useLensStore.setState({ isOpen: true, view: 'ask' })
        setPaletteOpen(true)
      } else if (event.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false)
        else if (isOpen) close()
      }
    }
    addEventListener('keydown', keyDown, true)
    return () => removeEventListener('keydown', keyDown, true)
  }, [close, isOpen, paletteOpen])

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.type === 'TOGGLE_LENS') toggle()
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [toggle])

  const submitCommand = (question: string) => {
    useLensStore.setState({ isOpen: true, view: 'ask' })
    void ask(question)
  }

  return (
    <LensErrorBoundary>
      <LensTrigger
        isOpen={isOpen}
        attentionCount={activity?.attentionCount ?? 3}
        investigating={status === 'investigating'}
        onClick={toggle}
      />
      <LensPanel />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSubmit={submitCommand} />
    </LensErrorBoundary>
  )
}

export function mountLens(): void {
  if (document.getElementById(HOST_ID)) return
  const host = document.createElement('div')
  host.id = HOST_ID
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = lensCss
  const mount = document.createElement('div')
  mount.id = 'repoguardian-lens-root'
  shadow.append(style, mount)
  document.documentElement.appendChild(host)
  createRoot(mount).render(<LensApp />)
}
