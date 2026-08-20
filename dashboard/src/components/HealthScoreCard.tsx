import { Activity, TrendingDown, TrendingUp, Minus } from 'lucide-react'

import {
  HealthMetricBreakdown,
  scoreBand,
  type HealthComponentScore,
} from '@/components/HealthMetricBreakdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface HealthScoreCardProps {
  overallScore: number
  components: HealthComponentScore[]
  trend?: 'up' | 'down' | 'flat'
  onViewBreakdown?: () => void
  className?: string
}

const trendMeta = {
  up: { icon: TrendingUp, label: 'improving', className: 'text-success' },
  down: { icon: TrendingDown, label: 'declining', className: 'text-critical' },
  flat: { icon: Minus, label: 'steady', className: 'text-text-muted' },
} satisfies Record<
  'up' | 'down' | 'flat',
  { icon: typeof TrendingUp; label: string; className: string }
>

/**
 * Overall project health with its components always visible (F10).
 *
 * The compact breakdown is not optional decoration. DESIGN.md 7.5 states the
 * score must always reveal its parts, and FRONTEND-D.md makes it an
 * acceptance criterion: this card never renders `overallScore` without at
 * least a compact view of `components` alongside it. A lone number tells a
 * maintainer their project is a 62 without telling them what to fix.
 *
 * The trend is labelled in words as well as an arrow, so it survives both
 * greyscale and a screen reader.
 */
export function HealthScoreCard({
  overallScore,
  components,
  trend,
  onViewBreakdown,
  className,
}: HealthScoreCardProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(overallScore)))
  const band = scoreBand(clamped)
  const trendInfo = trend ? trendMeta[trend] : null
  const TrendIcon = trendInfo?.icon

  // Surfaced so a mismatch is visible rather than silently misreported: the
  // six documented weights sum to 1.0, but repos may configure them and the
  // backend is the source of truth.
  const weightSum = components.reduce(
    (total, component) => total + component.weight,
    0,
  )
  const weightsLookOff = components.length > 0 && Math.abs(weightSum - 1) > 0.01

  return (
    <section
      aria-label="Project health"
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-4',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity aria-hidden="true" className="size-4 text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Project health
          </h2>
        </div>
        {onViewBreakdown ? (
          <Button
            className="h-7 px-2 text-xs"
            onClick={onViewBreakdown}
            size="sm"
            type="button"
            variant="ghost"
          >
            Details
          </Button>
        ) : null}
      </div>

      <div className="flex items-end gap-3">
        <p className={cn('text-4xl font-semibold tabular-nums', band.text)}>
          {clamped}
        </p>
        <div className="flex flex-col gap-0.5 pb-1">
          <span className="text-xs text-text-muted">out of 100</span>
          <span className={cn('text-xs font-medium', band.text)}>
            {band.label}
          </span>
        </div>
        {trendInfo && TrendIcon ? (
          <span
            className={cn(
              'ml-auto flex items-center gap-1 pb-1 text-xs',
              trendInfo.className,
            )}
          >
            <TrendIcon aria-hidden="true" className="size-3.5" />
            {trendInfo.label}
          </span>
        ) : null}
      </div>

      {components.length > 0 ? (
        <HealthMetricBreakdown compact components={components} />
      ) : (
        <p className="text-xs text-text-muted">
          Component scores unavailable — showing the overall score only.
        </p>
      )}

      {weightsLookOff ? (
        <p className="text-xs text-warning">
          Component weights sum to {weightSum.toFixed(2)}, not 1.00.
        </p>
      ) : null}
    </section>
  )
}
