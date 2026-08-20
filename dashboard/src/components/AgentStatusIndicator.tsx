import { BrainCircuit, GitBranch, WifiOff } from 'lucide-react'

import type { ConnectionState } from '@/lib/useSocket'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface AgentStatusIndicatorProps {
  connectionState: ConnectionState
  githubConnected: boolean
  lastSyncAt: string | null
  className?: string
}

const agentState = {
  connecting: { label: 'Connecting', className: 'text-text-muted' },
  connected: { label: 'Active', className: 'text-accent' },
  reconnecting: { label: 'Reconnecting', className: 'text-warning' },
  offline: { label: 'Offline', className: 'text-critical' },
} satisfies Record<ConnectionState, { label: string; className: string }>

/**
 * Agent and GitHub connection state for the app chrome (F01).
 *
 * The two indicators are deliberately separate. The WebSocket can be down
 * while GitHub is fine, or the reverse -- conflating them into one dot hides
 * which one to debug, which is the worst possible outcome thirty seconds into
 * a demo.
 *
 * Every state is a word plus an icon, never a bare coloured dot
 * (dashboard/CLAUDE.md 8).
 */
export function AgentStatusIndicator({
  connectionState,
  githubConnected,
  lastSyncAt,
  className,
}: AgentStatusIndicatorProps) {
  const agent = agentState[connectionState]

  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}
    >
      <span className="flex items-center gap-1.5 text-xs">
        <BrainCircuit
          aria-hidden="true"
          className={cn('size-4 shrink-0', agent.className)}
        />
        <span className="text-text-muted">Agent:</span>
        <span className={cn('font-medium', agent.className)}>
          {agent.label}
        </span>
      </span>

      <span className="flex items-center gap-1.5 text-xs">
        {githubConnected ? (
          <GitBranch aria-hidden="true" className="size-4 shrink-0 text-accent" />
        ) : (
          <WifiOff
            aria-hidden="true"
            className="size-4 shrink-0 text-critical"
          />
        )}
        <span className="text-text-muted">GitHub:</span>
        <span
          className={cn(
            'font-medium',
            githubConnected ? 'text-accent' : 'text-critical',
          )}
        >
          {githubConnected ? 'Connected' : 'Unreachable'}
        </span>
      </span>

      {lastSyncAt ? (
        <span className="text-xs text-text-muted">
          Last sync {formatRelativeTime(lastSyncAt)}
        </span>
      ) : (
        <span className="text-xs text-text-muted">Never synced</span>
      )}
    </div>
  )
}
