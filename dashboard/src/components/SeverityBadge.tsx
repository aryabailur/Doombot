import {
  AlertCircle,
  BadgeCheck,
  Info,
  Lock,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export type EscalationSeverity = 'critical' | 'high' | 'warning' | 'info'

export interface SeverityBadgeProps {
  severity: EscalationSeverity
  size?: 'sm' | 'md'
  className?: string
}

interface SeverityStyle {
  label: string
  icon: LucideIcon
  classes: string
  weight: string
}

/**
 * Severity encoded four ways: colour, fill weight, icon, and the word.
 *
 * The palette has a measured defect (docs/DESIGN-ADDENDUM.md 2): --high
 * (#fb7185) has *higher* relative luminance than --critical (#f43f5e), and
 * --warning higher than both. On a dark surface brighter reads as more urgent,
 * so hue alone inverts the hierarchy exactly where it matters most -- the
 * escalation queue.
 *
 * The fix is not to change the tokens but to stop relying on hue: fill
 * opacity, border weight, and font weight all descend with severity, so the
 * ordering survives the inversion. That also satisfies DESIGN.md 8's rule
 * that colour is never the only signal, and keeps the badge legible in
 * greyscale.
 */
const severityStyles = {
  critical: {
    label: 'Critical',
    icon: TriangleAlert,
    classes: 'border-critical bg-critical/15 text-critical',
    weight: 'font-semibold',
  },
  high: {
    label: 'High',
    icon: TriangleAlert,
    classes: 'border-high/70 bg-high/10 text-high',
    weight: 'font-medium',
  },
  warning: {
    label: 'Warning',
    icon: AlertCircle,
    classes: 'border-warning/60 bg-transparent text-warning',
    weight: 'font-medium',
  },
  info: {
    label: 'Info',
    icon: Info,
    classes: 'border-information/50 bg-transparent text-information',
    weight: 'font-normal',
  },
} satisfies Record<EscalationSeverity, SeverityStyle>

export function SeverityBadge({
  severity,
  size = 'md',
  className,
}: SeverityBadgeProps) {
  const style = severityStyles[severity]
  const Icon = style.icon

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border uppercase tracking-wide',
        style.classes,
        style.weight,
        // 12px is the floor and only for labels like this one, never body copy
        // (docs/DESIGN-ADDENDUM.md 3).
        size === 'sm' ? 'gap-1 px-1.5 py-0.5 text-xs' : 'gap-1.5 px-2 py-0.5 text-xs',
        className,
      )}
      data-severity={severity}
    >
      <Icon
        aria-hidden="true"
        className={cn('shrink-0', size === 'sm' ? 'size-3' : 'size-3.5')}
      />
      {style.label}
    </span>
  )
}

export interface VisibilityBadgeProps {
  isPublic: boolean
  className?: string
}

/**
 * Private-versus-public marker for a security-sensitive escalation.
 *
 * DESIGN.md 12 makes publishing a suspected vulnerability prohibited by
 * default, so a private finding must never look identical to a public one in
 * the queue. Rendered as an icon plus the word "Private", not a tooltip --
 * a marker a maintainer has to hover to discover is not a marker.
 */
export function VisibilityBadge({ isPublic, className }: VisibilityBadgeProps) {
  if (isPublic) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-text-muted',
          className,
        )}
      >
        <BadgeCheck aria-hidden="true" className="size-3 shrink-0" />
        Public
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-accent/50 bg-accent-muted px-1.5 py-0.5 text-xs font-medium text-accent-bright',
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-3 shrink-0" />
      Private
    </span>
  )
}
