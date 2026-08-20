import {
  CircleDot,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  ShieldCheck,
} from 'lucide-react'

import { ConfidenceIndicator } from '@/components/ConfidenceIndicator'
import type { Evidence } from '@/lib/types'

export interface EvidenceCardProps {
  evidence: Evidence
  onOpenSource?: (evidence: Evidence) => void
}

const evidenceMetadata = {
  issue: { icon: CircleDot, label: 'Issue' },
  pr: { icon: GitPullRequest, label: 'Pull request' },
  file: { icon: FileCode2, label: 'File' },
  rule: { icon: ShieldCheck, label: 'Rule' },
} satisfies Record<
  Evidence['type'],
  { icon: typeof CircleDot; label: string }
>

export function EvidenceCard({
  evidence,
  onOpenSource,
}: EvidenceCardProps) {
  const { icon: Icon, label } = evidenceMetadata[evidence.type]

  return (
    <article className="rounded-lg border border-border bg-surface-2 p-3 shadow-raised">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface-3 text-text-secondary">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {label}
            </p>
            <p className="truncate font-mono text-sm text-text-primary" title={evidence.ref}>
              {evidence.ref}
            </p>
          </div>
        </div>

        {onOpenSource ? (
          <button
            aria-label={`Open ${label.toLowerCase()} ${evidence.ref}`}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-accent-bright transition-colors [transition-duration:var(--motion-fast)] hover:bg-accent-muted focus-visible:outline-none"
            onClick={() => onOpenSource(evidence)}
            type="button"
          >
            Open
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>

      <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-border pl-3 font-mono text-sm leading-5 text-text-secondary">
        {evidence.snippet || 'No excerpt available.'}
      </blockquote>

      {evidence.score !== null ? (
        <div className="mt-3">
          <ConfidenceIndicator score={evidence.score} size="sm" />
        </div>
      ) : null}
    </article>
  )
}
