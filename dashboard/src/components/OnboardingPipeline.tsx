import { useEffect, useState } from 'react'

import {
  BrainCircuit,
  Check,
  Database,
  Plug,
  Search,
  TriangleAlert,
} from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The add-a-repository pipeline, narrated.
 *
 * Adding a repository does real, slow work -- reaching GitHub, embedding the
 * backlog into Chroma, then running the triage graph over each open issue --
 * and none of it was visible. The click was followed by half a minute of
 * nothing, then numbers appearing. Invisible work reads as either broken or
 * faked, and the reasoning chain being visible is the whole point of the
 * product, so hiding the setup contradicts it.
 *
 * Every stage here is driven by a `pipeline` event the API emits at the moment
 * that work actually starts or finishes. Nothing is on a timer and nothing is
 * simulated: if embedding takes twenty seconds, this sits on "Embedding" for
 * twenty seconds. A progress display that lies is worse than none.
 */

export type PipelineStage = 'connect' | 'index' | 'scan' | 'investigate'
export type PipelineStatus = 'idle' | 'running' | 'done' | 'error'

export interface PipelineEvent {
  stage: PipelineStage
  status: PipelineStatus
  repo_name?: string
  message?: string
  indexed?: number
  index?: number
  total?: number
  issue_number?: number
}

export interface OnboardingPipelineProps {
  /** Latest event per stage, in arrival order. */
  events: PipelineEvent[]
  repoName?: string
  /** Current agent step name, straight off the trace. */
  currentStep?: string | null
  onDismiss?: () => void
  className?: string
}

const STAGES: {
  id: PipelineStage
  label: string
  detail: string
  icon: typeof Plug
}[] = [
  {
    id: 'connect',
    label: 'Connect',
    detail: 'Reaching the repository on GitHub',
    icon: Plug,
  },
  {
    id: 'index',
    label: 'Embed',
    detail: 'Turning issues into vectors for duplicate search',
    icon: Database,
  },
  {
    id: 'scan',
    label: 'Select',
    detail: 'Choosing which open issues need a look',
    icon: Search,
  },
  {
    id: 'investigate',
    label: 'Investigate',
    detail: 'Running the triage graph, one issue at a time',
    icon: BrainCircuit,
  },
]

function statusOf(
  events: PipelineEvent[],
  stage: PipelineStage,
): { status: PipelineStatus; event?: PipelineEvent } {
  // Last event wins: a stage can go running -> done, and only the latest
  // matters. Searching backwards avoids rebuilding a map every render.
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].stage === stage) {
      return { status: events[index].status, event: events[index] }
    }
  }
  return { status: 'idle' }
}

export function OnboardingPipeline({
  events,
  repoName,
  currentStep,
  onDismiss,
  className,
}: OnboardingPipelineProps) {
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const finished =
    statusOf(events, 'scan').status === 'done' ||
    statusOf(events, 'connect').status === 'error'

  return (
    <section
      aria-label="Repository setup progress"
      aria-live="polite"
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5',
        className,
      )}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Bringing {repoName ?? 'the repository'} online
        </h2>
        {finished && onDismiss ? (
          <button
            className="ml-auto text-xs text-text-muted underline-offset-2 hover:underline"
            onClick={onDismiss}
            type="button"
          >
            Dismiss
          </button>
        ) : null}
      </div>

      <ol className="flex flex-col gap-0">
        {STAGES.map((stage, position) => {
          const { status, event } = statusOf(events, stage.id)
          const Icon =
            status === 'error'
              ? TriangleAlert
              : status === 'done'
                ? Check
                : stage.icon
          const isLast = position === STAGES.length - 1

          return (
            <li className="flex gap-3" key={stage.id}>
              {/* Rail: a dot per stage joined by a line, so the sequence reads
                  as one flow rather than four unrelated rows. */}
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors',
                    status === 'idle' && 'border-border bg-surface-2',
                    status === 'running' &&
                      'border-accent bg-accent-muted text-accent-bright',
                    status === 'done' && 'border-accent bg-accent text-background',
                    status === 'error' &&
                      'border-critical bg-surface-2 text-critical',
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      'size-4',
                      status === 'running' &&
                        !reducedMotion &&
                        'motion-safe:animate-pulse',
                    )}
                  />
                </span>
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'w-px flex-1 transition-colors',
                      status === 'done' ? 'bg-accent' : 'bg-border',
                    )}
                  />
                ) : null}
              </div>

              <div className={cn('min-w-0 pb-5', isLast && 'pb-0')}>
                <p
                  className={cn(
                    'text-sm font-medium',
                    status === 'idle' && 'text-text-muted',
                    status === 'running' && 'text-text-primary',
                    status === 'done' && 'text-text-secondary',
                    status === 'error' && 'text-critical',
                  )}
                >
                  {stage.label}
                  {status === 'running' && stage.id === 'investigate' &&
                  event?.total ? (
                    <span className="ml-2 text-xs tabular-nums text-text-muted">
                      {event.index} of {event.total}
                    </span>
                  ) : null}
                </p>

                {/* The API's own message when there is one, so the text is
                    whatever actually happened rather than a guess. */}
                <p className="mt-0.5 text-xs leading-5 text-text-muted">
                  {event?.message ?? stage.detail}
                </p>

                {/* The live agent step, shown only while investigating -- this
                    is the reasoning chain arriving in real time. */}
                {status === 'running' &&
                stage.id === 'investigate' &&
                currentStep ? (
                  <p className="mt-1 truncate font-mono text-xs text-accent-bright">
                    {currentStep}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
