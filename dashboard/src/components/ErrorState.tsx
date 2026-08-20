import {
  CircleAlert,
  Clock,
  DatabaseZap,
  Lock,
  ShieldAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ErrorKind =
  | 'auth'
  | 'rate_limited'
  | 'agent_failure'
  | 'rag_unavailable'
  | 'permission_denied'
  | 'network'
  | 'unknown'

export interface ErrorStateProps {
  kind: ErrorKind
  message?: string
  onRetry?: () => void
  className?: string
}

interface ErrorCopy {
  icon: LucideIcon
  title: string
  description: string
  retryable: boolean
}

/**
 * One place where each failure mode gets its wording.
 *
 * `kind` exists so five screens hitting a GitHub rate limit all say the same
 * thing. This component is how the auth / rate-limit / agent-failure /
 * rag-unavailable / permission-denied entries in the twelve-state checklist
 * (dashboard/CLAUDE.md 7) get implemented once instead of per component.
 *
 * Copy says what to do next where there is something to do -- "Something
 * went wrong" tells a maintainer nothing.
 */
const errorCopy = {
  auth: {
    icon: ShieldAlert,
    title: 'Not authenticated',
    description:
      'The GitHub token is missing or expired. Check GITHUB_TOKEN in .env and reload.',
    retryable: false,
  },
  rate_limited: {
    icon: Clock,
    title: 'GitHub rate limit reached',
    description:
      'Showing cached data until the limit resets. New investigations will fail until then.',
    retryable: true,
  },
  agent_failure: {
    icon: CircleAlert,
    title: 'The agent could not finish',
    description:
      'A step failed mid-investigation. Any completed steps are still shown below.',
    retryable: true,
  },
  rag_unavailable: {
    icon: DatabaseZap,
    title: 'Repository index unavailable',
    description:
      'This repository has not been indexed yet, so duplicate detection is unavailable. Run indexing to enable it.',
    retryable: true,
  },
  permission_denied: {
    icon: Lock,
    title: 'Permission denied',
    description:
      'The token cannot perform this action on this repository. It likely needs Issues write access.',
    retryable: false,
  },
  network: {
    icon: WifiOff,
    title: 'Cannot reach the backend',
    description:
      'The API is not responding. Check that it is running on port 8000.',
    retryable: true,
  },
  unknown: {
    icon: CircleAlert,
    title: 'Something went wrong',
    description: 'The request failed for an unexpected reason.',
    retryable: true,
  },
} satisfies Record<ErrorKind, ErrorCopy>

export function ErrorState({
  kind,
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  const copy = errorCopy[kind]
  const Icon = copy.icon

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-critical/30 bg-critical/5 px-6 py-10 text-center',
        className,
      )}
      role="alert"
    >
      <Icon aria-hidden="true" className="size-8 text-critical" />
      <div className="space-y-1">
        <p className="text-base font-semibold text-text-primary">
          {copy.title}
        </p>
        {/*
          `message` overrides the default copy but is never rendered raw as the
          only explanation -- a backend exception string is not user-facing text,
          and per DESIGN.md 12 it could carry internals we must not surface.
        */}
        <p className="mx-auto max-w-md text-sm text-text-secondary">
          {message ?? copy.description}
        </p>
      </div>
      {onRetry && copy.retryable ? (
        <Button
          className="mt-1"
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      ) : null}
    </div>
  )
}
