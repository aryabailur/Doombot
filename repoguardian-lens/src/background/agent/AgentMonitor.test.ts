import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { AgentMonitor } from './AgentMonitor'

/** Minimal WebSocket stand-in: a service worker has no DOM to drive one. */
class FakeSocket {
  static last?: FakeSocket
  readyState = 0
  sent: unknown[] = []
  listeners: Record<string, Array<(event: unknown) => void>> = {}
  constructor(readonly url: string) { FakeSocket.last = this }
  addEventListener(type: string, fn: (event: unknown) => void) {
    ;(this.listeners[type] ??= []).push(fn)
  }
  close() { this.readyState = 3; this.emit('close', {}) }
  emit(type: string, event: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(event)
  }
  open() { this.readyState = 1; this.emit('open', {}) }
  send(data: unknown) { this.sent.push(data); this.emit('message', { data: JSON.stringify(data) }) }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
  Object.assign(globalThis.WebSocket, { OPEN: 1, CONNECTING: 0 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const step = {
  step_id: 'st1',
  investigation_id: 'inv1',
  seq: 0,
  name: 'security_scanner',
  title: 'Scanning for security concerns',
  status: 'done' as const,
  output_summary: 'Matched api key',
  duration_ms: 996,
  started_at: '2026-08-20T15:00:00Z',
}

describe('AgentMonitor', () => {
  it('derives the ws URL from an http backend origin', () => {
    new AgentMonitor().connect('http://localhost:8000')
    expect(FakeSocket.last?.url).toBe('ws://localhost:8000/ws')
  })

  it('uses wss for an https backend rather than downgrading', () => {
    new AgentMonitor().connect('https://agent.example.com/')
    expect(FakeSocket.last?.url).toBe('wss://agent.example.com/ws')
  })

  it('sends a heartbeat while connected so Chrome can keep the worker active', () => {
    vi.useFakeTimers()
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    const socket = FakeSocket.last!
    socket.open()

    vi.advanceTimersByTime(20_000)

    expect(socket.sent).toContain('ping')
    monitor.disconnect()
  })

  it('flattens all four backend envelope types into one feed', () => {
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    const socket = FakeSocket.last!
    socket.open()

    socket.send({ type: 'activity', data: { ts: '2026-08-20T15:00:00Z', repo_name: 'a/b', message: 'Detected #7 — starting investigation', severity: 'info' } })
    socket.send({ type: 'step.started', step: { ...step, status: 'running' } })
    socket.send({ type: 'step.completed', step })
    socket.send({ type: 'investigation.completed', data: { investigation_id: 'inv1', decision: 'escalate' } })

    const feed = monitor.snapshot()
    // Newest first, so the decision leads.
    expect(feed[0].kind).toBe('decision')
    expect(feed[0].message).toContain('escalate')
    expect(feed.map((e) => e.kind)).toEqual(['decision', 'step', 'step', 'activity', 'connection'])

    const started = feed.find((e) => e.running)
    expect(started?.state).toBe('checking_precedent')
    expect(feed.find((e) => e.durationMs === 996)).toBeDefined()
    expect(
      feed.find((e) => e.kind === 'activity' && e.repository === 'a/b')?.message,
    ).toContain('Detected #7')
  })

  it('accepts the data key the backend actually emits', () => {
    // agents/chain.py emits {"type": "step.completed", "data": rec}; the
    // api/ws.py docstring says "step". Both must work.
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    FakeSocket.last!.open()
    FakeSocket.last!.send({ type: 'step.completed', data: step })

    const event = monitor.snapshot()[0]
    expect(event.kind).toBe('step')
    expect(event.state).toBe('checking_precedent')
    expect(event.durationMs).toBe(996)
  })

  it('associates autonomous steps with their repository and filters the feed', () => {
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    FakeSocket.last!.open()
    FakeSocket.last!.send({
      type: 'activity',
      data: {
        ts: '2026-08-20T15:00:00Z',
        repo_name: 'a/b',
        message: 'Detected #7 — starting investigation',
        severity: 'info',
      },
    })
    FakeSocket.last!.send({ type: 'step.completed', data: step })
    FakeSocket.last!.send({
      type: 'investigation.completed',
      data: { investigation_id: 'inv1', decision: 'escalate' },
    })

    const matching = monitor.snapshot('a/b')
    expect(matching.some((event) => event.kind === 'step')).toBe(true)
    expect(matching.some((event) => event.kind === 'decision')).toBe(true)
    expect(matching.every((event) => !event.repository || event.repository === 'a/b')).toBe(true)
    expect(monitor.snapshot('x/y').map((event) => event.kind)).toEqual(['connection'])
  })

  it('restores persisted events and notifies subscribers only for new activity', () => {
    const restored = {
      id: 'old',
      kind: 'activity' as const,
      message: 'Previously observed',
      timestamp: '2026-08-20T14:00:00Z',
      severity: 'info' as const,
      repository: 'a/b',
    }
    const monitor = new AgentMonitor()
    const received: string[] = []
    monitor.subscribe((event) => received.push(event.id))
    monitor.restore([restored])

    expect(monitor.snapshot()).toEqual([restored])
    expect(received).toEqual([])

    monitor.connect('http://localhost:8000')
    FakeSocket.last!.open()
    expect(received).toHaveLength(1)
    expect(received[0]).toContain('connected-')
  })

  it('marks an errored step as an error rather than progress', () => {
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    FakeSocket.last!.open()
    FakeSocket.last!.send({ type: 'step.completed', step: { ...step, status: 'error', output_summary: 'GitHub 404' } })

    const event = monitor.snapshot()[0]
    expect(event.severity).toBe('error')
    expect(event.state).toBe('failed')
    expect(event.message).toContain('GitHub 404')
  })

  it('ignores malformed frames instead of breaking the feed', () => {
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    FakeSocket.last!.open()
    FakeSocket.last!.emit('message', { data: 'not json' })
    FakeSocket.last!.send({ type: 'unknown.event', data: {} })
    // Only the connection notice survives.
    expect(monitor.snapshot().map((e) => e.kind)).toEqual(['connection'])
  })

  it('drops duplicate ids so a reconnect does not double-list steps', () => {
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    FakeSocket.last!.open()
    FakeSocket.last!.send({ type: 'step.completed', step })
    FakeSocket.last!.send({ type: 'step.completed', step })
    expect(monitor.snapshot().filter((e) => e.kind === 'step')).toHaveLength(1)
  })

  it('bounds the buffer so a long-running worker cannot leak', () => {
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    FakeSocket.last!.open()
    for (let i = 0; i < 200; i += 1) {
      FakeSocket.last!.send({ type: 'step.completed', step: { ...step, step_id: `st${i}` } })
    }
    expect(monitor.snapshot().length).toBeLessThanOrEqual(60)
  })

  it('reports disconnected once the socket closes', () => {
    const monitor = new AgentMonitor()
    monitor.connect('http://localhost:8000')
    FakeSocket.last!.open()
    expect(monitor.connected()).toBe(true)
    monitor.disconnect()
    expect(monitor.connected()).toBe(false)
  })
})
