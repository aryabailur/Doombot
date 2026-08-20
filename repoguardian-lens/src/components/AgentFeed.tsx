/**
 * Live feed of the agent's own work.
 *
 * Everything else in the panel answers a question the user just asked. This
 * shows what the agent did without being asked -- the monitor loop finding a
 * new issue, opening an investigation, and deciding -- which is the part of
 * PS-04 that makes the product agentic rather than a lookup tool.
 *
 * Events arrive over the service worker's WebSocket subscription; this
 * component only renders the buffer.
 */

import { Activity, AlertTriangle, Check, Circle, Loader2 } from 'lucide-react'

import type { AgentActivityEvent } from '@/lib/types'

function Icon({ event }: { event: AgentActivityEvent }) {
  if (event.severity === 'error') return <AlertTriangle aria-hidden="true" size={13} />
  if (event.running) return <Loader2 aria-hidden="true" size={13} className="rg-feed-spin" />
  if (event.kind === 'decision') return <Check aria-hidden="true" size={13} />
  if (event.kind === 'connection') return <Circle aria-hidden="true" size={9} />
  return <Activity aria-hidden="true" size={13} />
}

function relative(timestamp: string): string {
  const then = new Date(timestamp).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

export function AgentFeed({
  events,
  connected,
  demoMode,
  backendConfigured,
}: {
  events: AgentActivityEvent[]
  connected: boolean
  demoMode: boolean
  backendConfigured: boolean
}) {
  // Each state is distinct and explicit: the feed must never look "empty but
  // fine" when it is actually not subscribed to anything.
  if (demoMode) {
    return (
      <section className="rg-section">
        <div className="rg-section-heading">
          <div>
            <span className="rg-eyebrow">Agent activity</span>
            <h2>Not monitoring in demo mode</h2>
          </div>
        </div>
        <p className="rg-feed-note">
          Demo mode is offline by design. Switch to Live GitHub with a configured backend to watch
          the agent monitor a repository on its own.
        </p>
      </section>
    )
  }

  if (!backendConfigured) {
    return (
      <section className="rg-section">
        <div className="rg-section-heading">
          <div>
            <span className="rg-eyebrow">Agent activity</span>
            <h2>No backend configured</h2>
          </div>
        </div>
        <p className="rg-feed-note">
          Autonomous monitoring runs in the RepoGuardian backend. Set its origin in the extension
          options to stream what the agent is doing.
        </p>
      </section>
    )
  }

  return (
    <section className="rg-section">
      <div className="rg-section-heading">
        <div>
          <span className="rg-eyebrow">Agent activity</span>
          <h2>{connected ? 'Monitoring live' : 'Reconnecting'}</h2>
        </div>
        <span className={`rg-feed-status ${connected ? 'is-live' : ''}`}>
          <span aria-hidden="true">●</span> {connected ? 'Connected' : 'Offline'}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="rg-feed-note">
          Connected and waiting. The agent reports here when it scans a repository or opens an
          investigation on its own.
        </p>
      ) : (
        <ol className="rg-feed" aria-label="Agent activity feed">
          {events.map((event) => (
            <li key={event.id} className={`rg-feed-item is-${event.severity}`}>
              <span className="rg-feed-icon">
                <Icon event={event} />
              </span>
              <div>
                <p>{event.message}</p>
                <small>
                  {event.repository ? `${event.repository} · ` : ''}
                  {relative(event.timestamp)}
                  {event.durationMs != null ? ` · ${event.durationMs}ms` : ''}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
