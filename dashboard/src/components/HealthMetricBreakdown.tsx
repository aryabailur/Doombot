import { cn } from '@/lib/utils'

export type HealthComponentKey =
  | 'response'
  | 'backlog'
  | 'resolution'
  | 'pr_responsiveness'
  | 'contributor'
  | 'duplicate_rate'

export interface HealthComponentScore {
  key: HealthComponentKey
  label: string
  weight: number
  score: number
}

export interface HealthMetricBreakdownProps {
  components: HealthComponentScore[]
  compact?: boolean
  className?: string
}

/**
 * Score band for a single component. Thresholds are shared with
 * HealthScoreCard so a 62 never reads as "good" in one view and "poor" in
 * another.
 */
export function scoreBand(score: number): {
  label: string
  bar: string
  text: string
} {
  if (score >= 75) {
    return { label: 'healthy', bar: 'bg-success', text: 'text-success' }
  }
  if (score >= 50) {
    return { label: 'watch', bar: 'bg-warning', text: 'text-warning' }
  }
  return { label: 'at risk', bar: 'bg-critical', text: 'text-critical' }
}

/**
 * The component breakdown behind a health score (F10).
 *
 * DESIGN.md 7.5 requires the overall number always reveal its parts -- a bare
 * "Health: 84" is a spec violation, because a maintainer cannot act on a
 * single number. Every row shows its label, its weight, and its own score, so
 * the reader can see *which* dimension is dragging the total down.
 *
 * Weights are rendered from the data, never hardcoded here. DESIGN.md 7.5
 * calls its table the *initial* configuration and says repositories may
 * configure them, so treating the UI as the source of truth would silently
 * misreport any repo that changed them.
 */
export function HealthMetricBreakdown({
  components,
  compact = false,
  className,
}: HealthMetricBreakdownProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {components.map((component) => {
        const band = scoreBand(component.score)
        const clamped = Math.max(0, Math.min(100, component.score))
        return (
          <div className="flex flex-col gap-1" key={component.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-text-secondary">
                {component.label}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-text-muted">
                  {Math.round(component.weight * 100)}%
                </span>
                <span
                  className={cn('font-medium tabular-nums', band.text)}
                  // Band as text, not colour alone -- dashboard/CLAUDE.md 8.
                  title={`${component.label}: ${clamped} of 100 (${band.label})`}
                >
                  {clamped}
                </span>
              </span>
            </div>
            <div
              aria-hidden="true"
              className={cn(
                'w-full overflow-hidden rounded-full bg-surface-3',
                compact ? 'h-1' : 'h-1.5',
              )}
            >
              {/* The one legitimate inline style in the codebase: a data-driven
                  width cannot be a Tailwind class, since the value is
                  continuous and only known at runtime. The no-inline-styles
                  rule in dashboard/CLAUDE.md 12 exists to stop colour and
                  spacing bypassing the tokens, which this does not. */}
              <div
                className={cn('h-full rounded-full', band.bar)}
                style={{ width: `${clamped}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
