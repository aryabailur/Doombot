import {
  BadgeCheck,
  BrainCircuit,
  Search,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export type ActivityKind =
  | 'investigation'
  | 'escalation'
  | 'approval_needed'
  | 'action_taken'

export interface ActivityItem {
  id: string
  message: string
  timestamp: string
  kind: ActivityKind
}

export interface AgentActivityFeedProps {
  items: ActivityItem[]
  maxItems?: number
  className?: string
}

const kindMeta = {
  investigation: { icon: Search, className: 'text-information' },
  escalation: { icon: TriangleAlert, className: 'text-critical' },
  approval_needed: { icon: BrainCircuit, className: 'text-warning' },
  action_taken: { icon: BadgeCheck, className: 'text-accent' },
} satisfies Record<ActivityKind, { icon: LucideIcon; className: string }>

/**
 * What the agent has been doing (F01).
 *
 * Sorted newest-first from `timestamp` rather than trusting arrival order, so
 * a late-delivered WebSocket event cannot reorder items the reader has
 * already seen. FRONTEND-D.md makes stable ordering an acceptance criterion.
 *
 * Purely presentational: the caller owns the socket subscription and passes
 * items down. That keeps this component usable in contexts with no socket at
 * all, such as a static snapshot in the VS Code webview.
 *
 * aria-live is polite, not assertive -- a busy agent must not interrupt a
 * screen-reader user mid-sentence on every step.
 */
export function AgentActivityFeed({
  items,
  maxItems = 12,
  className,
}: AgentActivityFeedProps) {
  const visible = [...items]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, maxItems)

  return (
    <section
      aria-label="Agent activity"
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <BrainCircuit aria-hidden="true" className="size-4 text-accent" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Agent activity
        </h2>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          className="border-0 bg-transparent py-6"
          description="Activity appears here as the agent investigates."
          icon={BrainCircuit}
          title="Nothing yet"
        />
      ) : (
        <ul aria-live="polite" className="flex flex-col gap-2">
          {visible.map((item) => {
            const meta = kindMeta[item.kind]
            const Icon = meta.icon
            return (
              <li className="flex items-start gap-2 text-sm" key={item.id}>
                <Icon
                  aria-hidden="true"
                  className={cn('mt-0.5 size-4 shrink-0', meta.className)}
                />
                <span className="min-w-0 flex-1 text-text-primary">
                  {item.message}
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  {formatRelativeTime(item.timestamp)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
