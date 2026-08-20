export type ConfidenceTone = 'high' | 'medium' | 'low'

export interface ConfidenceLabel {
  label: string
  tone: ConfidenceTone
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', {
  numeric: 'auto',
})

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return '—'
  }

  if (ms < 1_000) {
    return `${Math.max(0, Math.round(ms))}ms`
  }

  const seconds = ms / 1_000
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
}

export function formatRelativeTime(iso: string): string {
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) {
    return '—'
  }

  const secondsFromNow = Math.round((timestamp - Date.now()) / 1_000)
  const ranges = [
    { limit: 60, divisor: 1, unit: 'second' },
    { limit: 3_600, divisor: 60, unit: 'minute' },
    { limit: 86_400, divisor: 3_600, unit: 'hour' },
    { limit: 604_800, divisor: 86_400, unit: 'day' },
    { limit: 2_629_800, divisor: 604_800, unit: 'week' },
    { limit: 31_557_600, divisor: 2_629_800, unit: 'month' },
  ] as const

  const absoluteSeconds = Math.abs(secondsFromNow)
  const range = ranges.find(({ limit }) => absoluteSeconds < limit)

  if (range) {
    return relativeTimeFormatter.format(
      Math.round(secondsFromNow / range.divisor),
      range.unit,
    )
  }

  return relativeTimeFormatter.format(
    Math.round(secondsFromNow / 31_557_600),
    'year',
  )
}

export function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 0.75) {
    return { label: 'High confidence', tone: 'high' }
  }

  if (score >= 0.4) {
    return { label: 'Medium confidence', tone: 'medium' }
  }

  return { label: 'Low confidence', tone: 'low' }
}
