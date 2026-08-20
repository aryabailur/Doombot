import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Activity, Radio, Search, TriangleAlert } from 'lucide-react'

import { InvestigationStep } from '@/components/InvestigationStep'
import { WS_URL } from '@/lib/api'
import type { StepRecord } from '@/lib/types'
import {
  useSocket,
  type ConnectionState,
  type WsEnvelope,
} from '@/lib/useSocket'
import { cn } from '@/lib/utils'

export interface InvestigationTraceProps {
  investigationId: string
  initialSteps: StepRecord[]
  live?: boolean
  className?: string
  onResync?: () => Promise<StepRecord[]>
}

// Falls back to the shared, API_BASE-derived socket URL so this component
// cannot drift from the host the REST calls use. VITE_WS_URL still wins for
// the case where the socket really is served from somewhere else.
const DEFAULT_WS_URL = WS_URL

function sortSteps(steps: StepRecord[]): StepRecord[] {
  return [...steps].sort(
    (left, right) => left.seq - right.seq || left.step_id.localeCompare(right.step_id),
  )
}

function isStepRecord(value: unknown): value is StepRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const step = value as Partial<StepRecord>
  return (
    typeof step.step_id === 'string' &&
    typeof step.investigation_id === 'string' &&
    typeof step.seq === 'number' &&
    typeof step.name === 'string' &&
    typeof step.title === 'string' &&
    (step.status === 'running' ||
      step.status === 'done' ||
      step.status === 'error') &&
    typeof step.input_summary === 'string' &&
    typeof step.output_summary === 'string' &&
    Array.isArray(step.evidence) &&
    typeof step.duration_ms === 'number' &&
    typeof step.started_at === 'string' &&
    (typeof step.ended_at === 'string' || step.ended_at === null)
  )
}

function mergeStep(steps: StepRecord[], nextStep: StepRecord): StepRecord[] {
  const existingIndex = steps.findIndex(
    (step) => step.step_id === nextStep.step_id,
  )

  if (existingIndex === -1) {
    return sortSteps([...steps, nextStep])
  }

  const merged = [...steps]
  merged[existingIndex] = nextStep
  return sortSteps(merged)
}

function AnimatedStep({
  children,
  complete,
}: {
  children: ReactNode
  complete: boolean
}) {
  const itemRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    const item = itemRef.current
    if (!item || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    item.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: 200,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'both',
      },
    )
  }, [])

  return (
    <li
      className="relative before:absolute before:-bottom-7 before:left-[15.5px] before:top-10 before:w-px before:bg-border before:content-[''] last:before:hidden data-[complete=true]:before:bg-accent"
      data-complete={complete}
      ref={itemRef}
    >
      {children}
    </li>
  )
}

function connectionMessage(connectionState: ConnectionState): string | null {
  if (connectionState === 'reconnecting') {
    return 'Reconnecting — this trace may be behind.'
  }

  if (connectionState === 'offline') {
    return 'Live updates are offline — this trace may be behind.'
  }

  return null
}

export function InvestigationTrace({
  investigationId,
  initialSteps,
  live = false,
  className,
  onResync,
}: InvestigationTraceProps) {
  const usingMocks = import.meta.env.VITE_USE_MOCKS === 'true'
  const [steps, setSteps] = useState(() => sortSteps(initialSteps))
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [announcement, setAnnouncement] = useState('')
  const [resyncError, setResyncError] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(false)
  const previousConnectionStateRef = useRef<ConnectionState>('connecting')

  const handleEvent = useCallback(
    (envelope: WsEnvelope) => {
      if (
        (envelope.type === 'step.started' ||
          envelope.type === 'step.completed') &&
        isStepRecord(envelope.data) &&
        envelope.data.investigation_id === investigationId
      ) {
        const nextStep = envelope.data
        const container = scrollContainerRef.current
        shouldAutoScrollRef.current =
          container !== null &&
          container.scrollHeight - container.scrollTop - container.clientHeight <=
            100

        setSteps((currentSteps) => mergeStep(currentSteps, nextStep))
        setAnnouncement(
          `${nextStep.title}: ${
            nextStep.status === 'error'
              ? 'failed'
              : nextStep.status
          }`,
        )
      }

      if (envelope.type === 'investigation.completed') {
        const data = envelope.data as { investigation_id?: unknown }
        if (data.investigation_id === investigationId) {
          setAnnouncement('Investigation completed.')
        }
      }
    },
    [investigationId],
  )

  const { connectionState, lastEventAt } = useSocket({
    url: import.meta.env.VITE_WS_URL || DEFAULT_WS_URL,
    onEvent: handleEvent,
    enabled: live && !usingMocks,
  })

  useEffect(() => {
    // REST props are authoritative after a parent refetch or route change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSteps(sortSteps(initialSteps))
  }, [initialSteps, investigationId])

  useEffect(() => {
    const previousConnectionState = previousConnectionStateRef.current
    previousConnectionStateRef.current = connectionState

    const reconnected =
      connectionState === 'connected' &&
      (previousConnectionState === 'reconnecting' ||
        previousConnectionState === 'offline')

    if (!reconnected || !onResync) {
      return
    }

    let cancelled = false
    setResyncError(false)

    void onResync()
      .then((freshSteps) => {
        if (!cancelled) {
          setSteps(sortSteps(freshSteps))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResyncError(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionState, onResync])

  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return
    }

    const container = scrollContainerRef.current
    container?.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
    shouldAutoScrollRef.current = false
  }, [steps.length])

  const staleMessage =
    live && !usingMocks ? connectionMessage(connectionState) : null

  return (
    <section
      aria-labelledby={`investigation-trace-${investigationId}`}
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-background shadow-raised',
        className,
      )}
    >
      <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-surface-1 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-accent-bright">
            <Search aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h3
              className="truncate text-base font-semibold text-text-primary"
              id={`investigation-trace-${investigationId}`}
            >
              Investigation trace
            </h3>
            <p className="truncate font-mono text-xs text-text-muted">
              {investigationId}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-sm text-text-secondary">
          {usingMocks ? (
            <>
              <Activity aria-hidden="true" className="size-4 text-information" />
              Fixture data
            </>
          ) : live ? (
            <>
              <Radio
                aria-hidden="true"
                className={cn(
                  'size-4',
                  connectionState === 'connected'
                    ? 'text-success'
                    : 'text-text-muted',
                )}
              />
              {connectionState === 'connected' ? 'Live' : 'Connecting'}
            </>
          ) : (
            'Historical'
          )}
        </div>
      </header>

      {staleMessage || resyncError ? (
        <div
          className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-2 text-sm text-warning"
          role="status"
        >
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          {resyncError
            ? 'Could not refresh after reconnect — retrying live updates.'
            : staleMessage}
        </div>
      ) : null}

      <div
        className="max-h-[38rem] overflow-y-auto px-5 py-5 [scrollbar-gutter:stable]"
        ref={scrollContainerRef}
      >
        {steps.length > 0 ? (
          <ol className="grid gap-4" aria-label="Investigation steps">
            {steps.map((step) => (
              <AnimatedStep
                complete={step.status === 'done'}
                key={step.step_id}
              >
                <div>
                  <InvestigationStep
                    expanded={expandedStepIds.has(step.step_id)}
                    onToggleExpand={() => {
                      setExpandedStepIds((currentIds) => {
                        const nextIds = new Set(currentIds)
                        if (nextIds.has(step.step_id)) {
                          nextIds.delete(step.step_id)
                        } else {
                          nextIds.add(step.step_id)
                        }
                        return nextIds
                      })
                    }}
                    step={step}
                  />
                </div>
              </AnimatedStep>
            ))}
          </ol>
        ) : (
          <div className="grid min-h-48 place-items-center text-center">
            <div>
              <Search
                aria-hidden="true"
                className="mx-auto size-8 text-text-muted"
              />
              <h4 className="mt-3 text-base font-semibold text-text-primary">
                Waiting to start
              </h4>
              <p className="mt-1 text-sm text-text-secondary">
                Investigation steps will appear here as the agent works.
              </p>
            </div>
          </div>
        )}
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {lastEventAt ? (
        <span className="sr-only">Last live update: {lastEventAt}</span>
      ) : null}
    </section>
  )
}
