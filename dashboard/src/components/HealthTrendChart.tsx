import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'

export type HealthAnnotationKind =
  | 'release'
  | 'incident'
  | 'policy_change'
  | 'unusual_activity'

export interface HealthTrendPoint {
  date: string
  score: number
  annotation?: { label: string; kind: HealthAnnotationKind }
}

export interface HealthTrendChartProps {
  data: HealthTrendPoint[]
  className?: string
}

/** Marker glyphs, so annotation kinds differ by shape and not only colour. */
const annotationMeta = {
  release: { symbol: '▲', label: 'Release' },
  incident: { symbol: '✕', label: 'Incident' },
  policy_change: { symbol: '■', label: 'Policy change' },
  unusual_activity: { symbol: '◆', label: 'Unusual activity' },
} satisfies Record<HealthAnnotationKind, { symbol: string; label: string }>

function shortDate(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) {
    return iso
  }
  return new Date(parsed).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Health over time (F10).
 *
 * Ships a visually hidden data table alongside the SVG. dashboard/CLAUDE.md 8
 * requires it: an SVG line is not readable by a screen reader, and the trend
 * is the whole point of the view, so the chart must not be the only way to
 * get the information. The summary sentence also gives a sighted reader the
 * headline without decoding the line.
 */
export function HealthTrendChart({ data, className }: HealthTrendChartProps) {
  if (data.length === 0) {
    return (
      <EmptyState
        description="Health is recorded after each scan. Run an investigation to start the series."
        icon={Activity}
        title="No health history yet"
      />
    )
  }

  const first = data[0]
  const last = data[data.length - 1]
  const delta = Math.round(last.score - first.score)
  const direction = delta > 0 ? 'rose' : delta < 0 ? 'fell' : 'held steady'
  const summary =
    data.length === 1
      ? `Health is ${Math.round(last.score)} as of ${shortDate(last.date)}.`
      : `Health ${direction} from ${Math.round(first.score)} to ${Math.round(
          last.score,
        )} between ${shortDate(first.date)} and ${shortDate(last.date)}.`

  // Narrow once here so the render paths below need no non-null assertions.
  type AnnotatedPoint = HealthTrendPoint & {
    annotation: NonNullable<HealthTrendPoint['annotation']>
  }
  const annotated = data.filter(
    (point): point is AnnotatedPoint => point.annotation !== undefined,
  )

  return (
    <section
      aria-label="Project health trend"
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Activity aria-hidden="true" className="size-4 text-accent" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Health trend
        </h2>
      </div>

      <p className="text-sm text-text-secondary">{summary}</p>

      <div aria-hidden="true" className="h-48 w-full">
        <ResponsiveContainer height="100%" width="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              stroke="var(--text-muted)"
              tick={{ fontSize: 11 }}
              tickFormatter={shortDate}
            />
            <YAxis
              domain={[0, 100]}
              stroke="var(--text-muted)"
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-3)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                fontSize: 12,
              }}
              labelFormatter={shortDate}
            />
            <Line
              dataKey="score"
              dot={false}
              stroke="var(--accent)"
              strokeWidth={2}
              type="monotone"
            />
            {annotated.map((point) => (
              <ReferenceDot
                fill="var(--warning)"
                key={point.date}
                r={4}
                stroke="var(--background)"
                x={point.date}
                y={point.score}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {annotated.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          {annotated.map((point) => {
            const meta = annotationMeta[point.annotation.kind]
            return (
              <li className="flex items-center gap-1.5" key={point.date}>
                <span aria-hidden="true" className="text-warning">
                  {meta.symbol}
                </span>
                <span>
                  {shortDate(point.date)} — {meta.label}:{' '}
                  {point.annotation.label}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}

      {/* The accessible equivalent of the chart above. */}
      <table className="sr-only">
        <caption>Project health score over time</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Score</th>
            <th scope="col">Event</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <td>{shortDate(point.date)}</td>
              <td>{Math.round(point.score)}</td>
              <td>
                {point.annotation
                  ? `${annotationMeta[point.annotation.kind].label}: ${point.annotation.label}`
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
