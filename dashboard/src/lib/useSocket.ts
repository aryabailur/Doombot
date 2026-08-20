import { useEffect, useRef, useState } from 'react'

export type WsEventType =
  | 'step.started'
  | 'step.completed'
  | 'investigation.completed'
  | 'activity'
  // Add-a-repository stage transitions: connect, index, scan, investigate.
  | 'pipeline'

export interface WsEnvelope<T = unknown> {
  type: WsEventType
  data: T
}

export interface UseSocketOptions {
  url: string
  onEvent: (envelope: WsEnvelope) => void
  enabled?: boolean
}

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'

export interface UseSocketResult {
  connectionState: ConnectionState
  lastEventAt: string | null
}

const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
const eventTypes = new Set<WsEventType>([
  'step.started',
  'step.completed',
  'investigation.completed',
  'activity',
  'pipeline',
])

function isWsEnvelope(value: unknown): value is WsEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as { type?: unknown; data?: unknown }
  return (
    typeof candidate.type === 'string' &&
    eventTypes.has(candidate.type as WsEventType) &&
    'data' in candidate
  )
}

export function useSocket({
  url,
  onEvent,
  enabled = true,
}: UseSocketOptions): UseSocketResult {
  const onEventRef = useRef(onEvent)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')
  const [lastEventAt, setLastEventAt] = useState<string | null>(null)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled) {
      return
    }

    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    let reconnectAttempt = 0
    let hasConnected = false

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const connect = () => {
      if (stopped) {
        return
      }

      if (
        socket?.readyState === WebSocket.CONNECTING ||
        socket?.readyState === WebSocket.OPEN
      ) {
        return
      }

      if (!navigator.onLine) {
        setConnectionState('offline')
        return
      }

      setConnectionState(hasConnected ? 'reconnecting' : 'connecting')
      const currentSocket = new WebSocket(url)
      socket = currentSocket

      currentSocket.addEventListener('open', () => {
        if (stopped || socket !== currentSocket) {
          currentSocket.close()
          return
        }

        hasConnected = true
        reconnectAttempt = 0
        setConnectionState('connected')
      })

      currentSocket.addEventListener('message', (message) => {
        if (socket !== currentSocket) {
          return
        }

        try {
          const envelope: unknown = JSON.parse(String(message.data))
          if (!isWsEnvelope(envelope)) {
            return
          }

          setLastEventAt(new Date().toISOString())
          onEventRef.current(envelope)
        } catch {
          // Ignore malformed events; a bad frame must not break reconnection.
        }
      })

      currentSocket.addEventListener('error', () => {
        currentSocket.close()
      })

      currentSocket.addEventListener('close', () => {
        if (stopped || socket !== currentSocket) {
          return
        }

        socket = null

        if (!navigator.onLine) {
          setConnectionState('offline')
          return
        }

        setConnectionState('reconnecting')
        const delay =
          BACKOFF_DELAYS_MS[
            Math.min(reconnectAttempt, BACKOFF_DELAYS_MS.length - 1)
          ]
        reconnectAttempt += 1
        reconnectTimer = setTimeout(connect, delay)
      })
    }

    const handleOffline = () => {
      clearReconnectTimer()
      setConnectionState('offline')
      const currentSocket = socket
      socket = null
      currentSocket?.close()
    }

    const handleOnline = () => {
      clearReconnectTimer()
      connect()
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    connect()

    return () => {
      stopped = true
      clearReconnectTimer()
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      socket?.close()
    }
  }, [enabled, url])

  return {
    connectionState: enabled ? connectionState : 'offline',
    lastEventAt,
  }
}
