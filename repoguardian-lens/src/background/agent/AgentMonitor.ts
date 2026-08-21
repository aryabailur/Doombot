/**
 * Live subscription to the backend's agent activity.
 *
 * This is what makes the Lens agentic rather than reactive. Without it the
 * panel only ever shows the result of something the user just asked for; with
 * it, the agent's own autonomous work -- the monitor loop discovering a new
 * issue and investigating it unprompted -- appears in the UI as it happens.
 *
 * The backend broadcasts four envelope types on /ws (see api/ws.py):
 *
 *   step.started            -> StepRecord, a node began
 *   step.completed          -> StepRecord, a node finished
 *   investigation.completed -> {investigation_id, decision, health_delta}
 *   activity                -> {ts, repo_name, message, severity}
 *
 * There is no room or auth: every client receives everything and filters
 * locally. That is correct at demo scale and means this class needs no
 * subscription handshake.
 *
 * A service worker can be terminated at any time, so this holds no state the
 * UI depends on beyond a bounded ring buffer -- the panel re-reads the buffer
 * on open rather than expecting to have been connected the whole time.
 */

import type { AgentActivityEvent, AgentRunState } from '@/lib/types'

/** Backend node name -> the UI's state machine (mirrors BackendAgentEngine). */
const NODE_STATE: Record<string, AgentRunState> = {
  issue_fetcher: 'reading',
  duplicate_detector: 'retrieving',
  resolver: 'comparing',
  security_scanner: 'checking_precedent',
  impact_scorer: 'assessing_impact',
  labeler: 'assessing_impact',
  decider: 'deciding',
}

type WsEnvelope =
  // `data` is what agents/chain.py emits and api/runner.py forwards verbatim;
  // api/ws.py's docstring documents `step`. Both are accepted so the feed does
  // not break whichever one the backend settles on.
  | { type: 'step.started'; data?: BackendStep; step?: BackendStep }
  | { type: 'step.completed'; data?: BackendStep; step?: BackendStep }
  | { type: 'investigation.completed'; data: { investigation_id: string; decision: string; health_delta?: number } }
  | { type: 'activity'; data: { ts: string; repo_name: string; message: string; severity: string } }

type BackendStep = {
  step_id: string
  investigation_id: string
  seq: number
  name: string
  title: string
  status: 'running' | 'done' | 'error'
  output_summary: string
  duration_ms: number
  started_at: string
}

/**
 * Keep the most recent activity only.
 *
 * An unbounded log in a service worker is a slow memory leak, and the panel
 * only ever renders the last handful. 60 entries is a few minutes of a busy
 * monitor cycle.
 */
const BUFFER_LIMIT = 60

type ActivityListener = (
  event: AgentActivityEvent,
  snapshot: AgentActivityEvent[],
) => void

export class AgentMonitor {
  private socket?: WebSocket
  private buffer: AgentActivityEvent[] = []
  private listeners = new Set<ActivityListener>()
  private investigationRepositories = new Map<string, string>()
  private activeRepository?: string
  private reconnectDelay = 1_000
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private keepAliveTimer?: ReturnType<typeof setInterval>
  private closedByUs = false
  private url?: string

  /** Most recent activity, newest first. */
  snapshot(repository?: string): AgentActivityEvent[] {
    const events = repository
      ? this.buffer.filter(
          (event) => event.kind === 'connection' || event.repository === repository,
        )
      : this.buffer
    return [...events].reverse()
  }

  /** Restore the bounded feed after Chrome restarts the MV3 service worker. */
  restore(events: AgentActivityEvent[]): void {
    this.buffer = events.slice(-BUFFER_LIMIT)
  }

  /** Observe newly received events without coupling transport to Chrome APIs. */
  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  /**
   * Connect to a backend origin, replacing any existing connection.
   *
   * `backendUrl` is an http(s) origin from settings; the socket scheme is
   * derived from it so an https backend does not get an insecure ws://.
   */
  connect(backendUrl: string): void {
    const wsUrl = `${backendUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`
    if (this.url === wsUrl && (this.connected() || this.socket?.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.disconnect()
    this.url = wsUrl
    this.closedByUs = false
    this.open()
  }

  disconnect(): void {
    this.closedByUs = true
    this.clearTimers()
    this.socket?.close()
    this.socket = undefined
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    if (this.keepAliveTimer !== undefined) clearInterval(this.keepAliveTimer)
    this.reconnectTimer = undefined
    this.keepAliveTimer = undefined
  }

  private open(): void {
    if (!this.url) return
    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch {
      // Malformed URL from the options page: stop rather than retry forever.
      return
    }
    this.socket = socket

    socket.addEventListener('open', () => {
      this.reconnectDelay = 1_000
      // Chrome 116+ resets a MV3 service worker's idle timer when WebSocket
      // traffic is exchanged. The backend intentionally accepts and discards
      // client text frames, so a small heartbeat keeps autonomous monitoring
      // alive while the repository is quiet.
      this.keepAliveTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping')
      }, 20_000)
      this.push({
        id: `connected-${Date.now()}`,
        kind: 'connection',
        message: 'Connected to the RepoGuardian agent',
        timestamp: new Date().toISOString(),
        severity: 'info',
      })
    })

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      let envelope: WsEnvelope
      try {
        envelope = JSON.parse(event.data) as WsEnvelope
      } catch {
        return
      }
      const mapped = this.toActivity(envelope)
      if (mapped) this.push(mapped)
    })

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      if (this.keepAliveTimer !== undefined) clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = undefined
      if (this.closedByUs) return
      // Exponential backoff, capped: the backend is usually restarting, and a
      // tight retry loop in a service worker burns battery for no benefit.
      const delay = this.reconnectDelay
      this.reconnectDelay = Math.min(delay * 2, 30_000)
      this.reconnectTimer = setTimeout(() => {
        if (!this.closedByUs) this.open()
      }, delay)
    })

    // A failed connection also fires close, so error only needs to not throw.
    socket.addEventListener('error', () => {})
  }

  private toActivity(envelope: WsEnvelope): AgentActivityEvent | null {
    switch (envelope.type) {
      case 'activity':
        if (/starting investigation/i.test(envelope.data.message)) {
          this.activeRepository = envelope.data.repo_name
        }
        return {
          id: `activity-${envelope.data.ts}-${envelope.data.message}`,
          kind: 'activity',
          message: envelope.data.message,
          repository: envelope.data.repo_name,
          timestamp: envelope.data.ts || new Date().toISOString(),
          severity: envelope.data.severity === 'error' ? 'error' : envelope.data.severity === 'warning' ? 'warning' : 'info',
        }

      case 'step.started': {
        const step = envelope.data ?? envelope.step
        if (!step) return null
        const repository =
          this.investigationRepositories.get(step.investigation_id) ??
          this.activeRepository
        if (repository) {
          this.investigationRepositories.set(step.investigation_id, repository)
        }
        return {
          id: `${step.step_id}-started`,
          kind: 'step',
          message: step.title,
          investigationId: step.investigation_id,
          repository,
          state: NODE_STATE[step.name] ?? 'comparing',
          timestamp: step.started_at || new Date().toISOString(),
          severity: 'info',
          running: true,
        }
      }

      case 'step.completed': {
        const step = envelope.data ?? envelope.step
        if (!step) return null
        const repository =
          this.investigationRepositories.get(step.investigation_id) ??
          this.activeRepository
        if (repository) {
          this.investigationRepositories.set(step.investigation_id, repository)
        }
        return {
          id: `${step.step_id}-completed`,
          kind: 'step',
          message: step.status === 'error'
            ? `${step.title} failed: ${step.output_summary}`
            : step.title,
          investigationId: step.investigation_id,
          repository,
          state: step.status === 'error' ? 'failed' : (NODE_STATE[step.name] ?? 'comparing'),
          timestamp: step.started_at || new Date().toISOString(),
          severity: step.status === 'error' ? 'error' : 'info',
          durationMs: step.duration_ms,
        }
      }

      case 'investigation.completed': {
        const repository = this.investigationRepositories.get(
          envelope.data.investigation_id,
        )
        this.investigationRepositories.delete(envelope.data.investigation_id)
        this.activeRepository = undefined
        return {
          id: `${envelope.data.investigation_id}-done`,
          kind: 'decision',
          message: `Investigation complete: ${envelope.data.decision}`,
          investigationId: envelope.data.investigation_id,
          repository,
          state: 'completed',
          timestamp: new Date().toISOString(),
          severity: envelope.data.decision === 'escalate' ? 'warning' : 'info',
        }
      }

      default:
        return null
    }
  }

  private push(event: AgentActivityEvent): void {
    // Duplicate ids arrive when the socket reconnects mid-investigation and
    // the backend re-broadcasts; the id is stable so dropping is safe.
    if (this.buffer.some((existing) => existing.id === event.id)) return
    this.buffer.push(event)
    if (this.buffer.length > BUFFER_LIMIT) {
      this.buffer = this.buffer.slice(-BUFFER_LIMIT)
    }
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(event, snapshot)
  }
}
