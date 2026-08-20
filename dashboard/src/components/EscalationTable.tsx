import { useCallback, useEffect, useRef } from 'react'
import { CircleDot, FilterX } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import {
  SeverityBadge,
  VisibilityBadge,
  type EscalationSeverity,
} from '@/components/SeverityBadge'
import { ConfidenceIndicator } from '@/components/ConfidenceIndicator'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export type EscalationStatus = 'pending' | 'approved' | 'rejected' | 'corrected'

export interface EscalationRow {
  id: string
  severity: EscalationSeverity
  category: string
  title: string
  issueRef: string
  confidence: number
  openedAt: string
  status: EscalationStatus
  isPublicVisibility: boolean
}

export interface EscalationFilters {
  severity?: EscalationSeverity[]
  category?: string[]
  minConfidence?: number
  status?: EscalationStatus[]
}

export interface EscalationTableProps {
  rows: EscalationRow[]
  selectedId?: string
  onSelect: (id: string) => void
  filters: EscalationFilters
  onFiltersChange: (filters: EscalationFilters) => void
}

const SEVERITY_ORDER: Record<EscalationSeverity, number> = {
  critical: 0,
  high: 1,
  warning: 2,
  info: 3,
}

const ALL_SEVERITIES: EscalationSeverity[] = [
  'critical',
  'high',
  'warning',
  'info',
]

export function applyFilters(
  rows: EscalationRow[],
  filters: EscalationFilters,
): EscalationRow[] {
  return rows.filter((row) => {
    if (filters.severity?.length && !filters.severity.includes(row.severity)) {
      return false
    }
    if (filters.category?.length && !filters.category.includes(row.category)) {
      return false
    }
    if (filters.status?.length && !filters.status.includes(row.status)) {
      return false
    }
    if (
      filters.minConfidence !== undefined &&
      row.confidence < filters.minConfidence
    ) {
      return false
    }
    return true
  })
}

/** Severity first, then confidence. The most urgent, best-evidenced item leads. */
export function sortRows(rows: EscalationRow[]): EscalationRow[] {
  return [...rows].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    return bySeverity !== 0 ? bySeverity : b.confidence - a.confidence
  })
}

function hasActiveFilters(filters: EscalationFilters): boolean {
  return Boolean(
    filters.severity?.length ||
      filters.category?.length ||
      filters.status?.length ||
      filters.minConfidence !== undefined,
  )
}

/**
 * The maintainer inbox (F04).
 *
 * Keyboard navigation is a requirement, not polish: DESIGN.md 7.2 and
 * dashboard/CLAUDE.md 8 both call for it, because triaging thirty escalations
 * with a mouse during a demo is the slow path. j/k and arrow keys move the
 * selection and update the preview pane.
 *
 * Handlers are scoped to this container rather than the document, so they
 * never hijack a key while someone is typing in a filter field elsewhere.
 */
export function EscalationTable({
  rows,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
}: EscalationTableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const visible = sortRows(applyFilters(rows, filters))
  const filtered = hasActiveFilters(filters)

  const move = useCallback(
    (delta: number) => {
      if (visible.length === 0) {
        return
      }
      const current = visible.findIndex((row) => row.id === selectedId)
      const next =
        current === -1
          ? 0
          : Math.min(Math.max(current + delta, 0), visible.length - 1)
      onSelect(visible[next].id)
    },
    [onSelect, selectedId, visible],
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Never swallow keys meant for a text input inside the queue.
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return
    }
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    }
  }

  // Keep the selected row in view when the selection changes by keyboard.
  useEffect(() => {
    if (!selectedId) {
      return
    }
    containerRef.current
      ?.querySelector(`[data-row-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (rows.length === 0) {
    return (
      <EmptyState
        description="Doombot has triaged everything it found. Nothing needs a maintainer right now."
        icon={CircleDot}
        title="Queue is clear"
      />
    )
  }

  if (visible.length === 0) {
    // Distinct from an empty queue: the data exists, the filters hide it.
    return (
      <EmptyState
        action={{ label: 'Clear filters', onClick: () => onFiltersChange({}) }}
        description={`${rows.length} escalation${rows.length === 1 ? '' : 's'} exist but none match the current filters.`}
        icon={FilterX}
        title="No escalations match your filters"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Severity
        </span>
        {ALL_SEVERITIES.map((severity) => {
          const active = filters.severity?.includes(severity) ?? false
          return (
            <Button
              aria-pressed={active}
              className={cn('h-7 px-2 text-xs', active && 'border-accent')}
              key={severity}
              onClick={() => {
                const current = filters.severity ?? []
                onFiltersChange({
                  ...filters,
                  severity: active
                    ? current.filter((item) => item !== severity)
                    : [...current, severity],
                })
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {severity}
            </Button>
          )
        })}
        {filtered ? (
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => onFiltersChange({})}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-text-muted">
        {visible.length} of {rows.length} shown. Use{' '}
        <kbd className="rounded border border-border px-1">j</kbd> /{' '}
        <kbd className="rounded border border-border px-1">k</kbd> to move.
      </p>

      <div
        aria-label="Escalation queue"
        className="flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-2 focus-visible:outline-2 focus-visible:outline-accent-bright"
        onKeyDown={handleKeyDown}
        ref={containerRef}
        role="listbox"
        tabIndex={0}
      >
        {visible.map((row) => {
          const selected = row.id === selectedId
          return (
            <button
              aria-selected={selected}
              className={cn(
                'flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-bright',
                selected
                  ? 'border-accent bg-surface-3'
                  : 'border-transparent bg-surface-2 hover:border-border',
              )}
              data-row-id={row.id}
              key={row.id}
              onClick={() => onSelect(row.id)}
              role="option"
              type="button"
            >
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={row.severity} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                  {row.title}
                </span>
                <ConfidenceIndicator score={row.confidence} size="sm" />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span className="font-mono">{row.issueRef}</span>
                <span aria-hidden="true">·</span>
                <span>{row.category}</span>
                <span aria-hidden="true">·</span>
                <span>opened {formatRelativeTime(row.openedAt)}</span>
                {row.status !== 'pending' ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-text-secondary">{row.status}</span>
                  </>
                ) : null}
                <VisibilityBadge
                  className="ml-auto"
                  isPublic={row.isPublicVisibility}
                />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
