/**
 * Options page: data source, optional GitHub token, optional backend origin.
 *
 * The token is stored in chrome.storage.local and read only by the service
 * worker. Nothing is bundled into the extension and nothing is sent anywhere
 * except api.github.com (spec section 42).
 */

import { useEffect, useState } from 'react'

import type { LensSettings } from '@/lib/types'
import { readSettings, saveSettings } from '@/lib/storage'
import '@/styles/lens.css'
import './options.css'

function backendOriginPattern(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
      ? `${url.protocol}//${url.host}/*`
      : undefined
  } catch {
    return undefined
  }
}

export function Options() {
  const [settings, setSettings] = useState<LensSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const [backendDraft, setBackendDraft] = useState('')
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    void readSettings().then((stored) => {
      setSettings(stored)
      setBackendDraft(stored.backendUrl ?? '')
    })
  }, [])

  if (!settings) {
    return <p className="rg-opt-note">Loading settings…</p>
  }

  const update = async (patch: Partial<LensSettings>) => {
    const next = await saveSettings(patch)
    setSettings(next)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
    // The worker memoises results per mode, so stale entries must go.
    try {
      await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: patch })
    } catch {
      // Worker asleep; it reads storage on next wake.
    }
  }

  const saveBackend = async () => {
    const value = backendDraft.trim()
    const previousOrigin = backendOriginPattern(settings.backendUrl)
    setBackendError(null)
    if (!value) {
      await update({ backendUrl: undefined })
      if (previousOrigin) {
        await chrome.permissions.remove({ origins: [previousOrigin] })
      }
      return
    }

    let url: URL
    try {
      url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      setBackendError('Enter a valid http:// or https:// backend origin.')
      return
    }

    const originPattern = `${url.protocol}//${url.host}/*`
    const granted = await chrome.permissions.request({ origins: [originPattern] })
    if (!granted) {
      setBackendError('Backend access was not granted. No setting was changed.')
      return
    }
    await update({ backendUrl: url.origin })
    setBackendDraft(url.origin)
    if (previousOrigin && previousOrigin !== originPattern) {
      await chrome.permissions.remove({ origins: [previousOrigin] })
    }
  }

  return (
    <main className="rg-opt">
      <header>
        <h1>
          <span aria-hidden="true">◆</span> RepoGuardian Lens
        </h1>
        <p className="rg-opt-note">Settings are stored locally in this browser profile.</p>
      </header>

      <section>
        <h2>Data source</h2>
        <div className="rg-opt-modes" role="radiogroup" aria-label="Data source">
          <button
            type="button"
            role="radio"
            aria-checked={settings.demoMode}
            className={settings.demoMode ? 'is-active' : ''}
            onClick={() => void update({ demoMode: true })}
          >
            <strong>Demo repository</strong>
            <span>Deterministic seeded data. Works with no network access.</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!settings.demoMode}
            className={!settings.demoMode ? 'is-active' : ''}
            onClick={() => void update({ demoMode: false })}
          >
            <strong>Live GitHub</strong>
            <span>Reads the repository you are viewing through the public GitHub API.</span>
          </button>
        </div>
      </section>

      <section>
        <h2>
          GitHub token{' '}
          <span className={settings.githubToken ? 'rg-opt-set' : 'rg-opt-optional'}>
            {settings.githubToken ? 'saved' : 'not set'}
          </span>
        </h2>
        <p className="rg-opt-note">
          Live mode works without a token at 60 requests/hour. A fine-grained token with public
          read access raises that to 5,000. It is never sent anywhere except api.github.com.
        </p>
        <input
          type="password"
          className="rg-opt-input"
          placeholder="github_pat_… or ghp_…"
          defaultValue={settings.githubToken ?? ''}
          onBlur={(event) => void update({ githubToken: event.target.value.trim() || undefined })}
          aria-label="GitHub personal access token"
        />
      </section>

      <section>
        <h2>
          RepoGuardian backend{' '}
          <span className={settings.backendUrl ? 'rg-opt-set' : 'rg-opt-optional'}>
            {settings.backendUrl ? 'saved' : 'not set'}
          </span>
        </h2>
        <p className="rg-opt-note">
          Origin of a running RepoGuardian API, e.g. <code>http://localhost:8000</code>. When set,
          live mode routes investigations through the backend's LangGraph triage for model-grade
          decisions. Left empty, live mode reads GitHub directly with deterministic scoring.
        </p>
        <input
          type="url"
          className="rg-opt-input"
          placeholder="Not set — paste an origin to enable the agent feed"
          value={backendDraft}
          onChange={(event) => setBackendDraft(event.target.value)}
          aria-label="RepoGuardian backend URL"
        />
        <div className="rg-action-row">
          <button className="rg-button rg-button--primary" type="button" onClick={() => void saveBackend()}>
            Save backend
          </button>
        </div>
        {backendError ? <p className="rg-inline-error" role="alert">{backendError}</p> : null}
      </section>

      <p className="rg-opt-saved" role="status">
        {saved ? 'Saved.' : ''}
      </p>
    </main>
  )
}

