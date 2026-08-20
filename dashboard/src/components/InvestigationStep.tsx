import { useId } from 'react'
import {
  BadgeCheck,
  ChevronDown,
  CircleX,
  LoaderCircle,
} from 'lucide-react'

import { EvidenceCard } from '@/components/EvidenceCard'
import { formatDuration } from '@/lib/format'
import type { StepRecord, StepStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface InvestigationStepProps {
  step: StepRecord
  expanded: boolean
  onToggleExpand: () => void
}

const statusMetadata = {
  running: {
    icon: LoaderCircle,
    label: 'Running',
    markerClassName: 'border-accent-bright bg-surface-1 text-accent-bright',
    statusClassName: 'text-accent-bright',
  },
  done: {
    icon: BadgeCheck,
    label: 'Done',
    markerClassName: 'border-accent bg-accent text-background',
    statusClassName: 'text-success',
  },
  error: {
    icon: CircleX,
    label: 'Failed',
    markerClassName: 'border-critical bg-surface-1 text-critical',
    statusClassName: 'text-critical',
  },
} satisfies Record<
  StepStatus,
  {
    icon: typeof BadgeCheck
    label: string
    markerClassName: string
    statusClassName: string
  }
>

export function InvestigationStep({
  step,
  expanded,
  onToggleExpand,
}: InvestigationStepProps) {
  const contentId = useId()
  const status = statusMetadata[step.status]
  const StatusIcon = status.icon
  const title = step.title || step.name || `Step ${step.seq}`
  const duration = step.status === 'running' ? '—' : formatDuration(step.duration_ms)

  return (
    <div
      aria-live={step.status === 'running' ? 'polite' : undefined}
      className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3"
      data-step-status={step.status}
    >
      <div className="relative z-base flex justify-center pt-3">
        <span
          className={cn(
            'grid size-7 place-items-center rounded-full border-2 shadow-raised',
            status.markerClassName,
          )}
        >
          <StatusIcon
            aria-hidden="true"
            className={cn(
              'size-4',
              step.status === 'running' && 'motion-safe:animate-spin',
            )}
          />
        </span>
      </div>

      <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-1 shadow-raised transition-colors [transition-duration:var(--motion-instant)] hover:border-accent/40">
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} step: ${title}`}
          className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left focus-visible:outline-none"
          onClick={onToggleExpand}
          type="button"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-primary">
              {title}
            </span>
            <span className="mt-0.5 block truncate font-mono text-xs text-text-muted">
              {step.name || `step-${step.seq}`}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-3">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm font-medium',
                status.statusClassName,
              )}
            >
              <StatusIcon aria-hidden="true" className="size-4" />
              {status.label}
            </span>
            <span className="min-w-12 text-right font-mono text-sm tabular-nums text-text-muted">
              {duration}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-4 text-text-muted transition-transform [transition-duration:var(--motion-base)]',
                expanded && 'rotate-180',
              )}
            />
          </span>
        </button>

        {expanded ? (
          <div className="border-t border-border px-4 py-4" id={contentId}>
            <dl className="grid gap-4 md:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Input
                </dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-text-secondary">
                  {step.input_summary || 'No input summary available.'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Output
                </dt>
                <dd
                  className={cn(
                    'mt-1 whitespace-pre-wrap break-words text-sm leading-5',
                    step.status === 'error'
                      ? 'text-critical'
                      : 'text-text-secondary',
                  )}
                >
                  {step.output_summary ||
                    (step.status === 'running'
                      ? 'This step is still running.'
                      : 'No output summary available.')}
                </dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-border pt-4">
              <h4 className="text-sm font-semibold text-text-primary">
                Evidence ({step.evidence.length})
              </h4>
              {step.evidence.length > 0 ? (
                <ul className="mt-3 grid gap-3">
                  {step.evidence.map((evidence, index) => (
                    <li key={`${evidence.type}-${evidence.ref}-${index}`}>
                      <EvidenceCard evidence={evidence} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-text-muted">
                  No supporting evidence attached.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
