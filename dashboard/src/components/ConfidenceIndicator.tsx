import { BadgeCheck, CircleAlert, CircleDashed } from 'lucide-react'

import {
  confidenceLabel,
  type ConfidenceTone,
} from '@/lib/format'
import { cn } from '@/lib/utils'

export type { ConfidenceTone } from '@/lib/format'

export interface ConfidenceIndicatorProps {
  score: number
  reason?: string
  size?: 'sm' | 'md'
}

const toneStyles: Record<ConfidenceTone, string> = {
  high: 'border-success/40 bg-success/10 text-success',
  medium: 'border-warning/40 bg-warning/10 text-warning',
  low: 'border-neutral/40 bg-neutral/10 text-neutral',
}

const toneIcons = {
  high: BadgeCheck,
  medium: CircleAlert,
  low: CircleDashed,
} satisfies Record<ConfidenceTone, typeof BadgeCheck>

export function ConfidenceIndicator({
  score,
  reason,
  size = 'md',
}: ConfidenceIndicatorProps) {
  const { label, tone } = confidenceLabel(score)
  const Icon = toneIcons[tone]
  const text = reason ? `${label} — ${reason}` : label
  const preciseScore = Math.round(Math.min(1, Math.max(0, score)) * 100)

  return (
    <span
      aria-label={text}
      className={cn(
        'inline-flex max-w-full items-center rounded-md border font-medium',
        toneStyles[tone],
        size === 'sm' ? 'gap-1 px-1.5 py-0.5 text-xs' : 'gap-1.5 px-2 py-1 text-sm',
      )}
      data-tone={tone}
      title={`${text} (${preciseScore}% confidence)`}
    >
      <Icon
        aria-hidden="true"
        className={cn('shrink-0', size === 'sm' ? 'size-3.5' : 'size-4')}
      />
      <span className="truncate">{text}</span>
    </span>
  )
}
