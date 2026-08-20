import { useState } from 'react'
import { MousePointerClick, Search } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import {
  SeverityBadge,
  VisibilityBadge,
} from '@/components/SeverityBadge'
import { ConfidenceIndicator } from '@/components/ConfidenceIndicator'
import { Button } from '@/components/ui/button'
import type { EscalationRow } from '@/components/EscalationTable'
import { formatRelativeTime } from '@/lib/format'

export interface EscalationPreviewProps {
  escalation: EscalationRow | null
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onCorrect: (id: string, note: string) => Promise<void>
  onOpenInvestigation: (investigationId: string) => void
}

type PendingAction = 'approve' | 'reject' | 'correct' | null

/**
 * Detail pane of the split-view queue (F04, DESIGN.md 7.2).
 *
 * Approve, reject, and correct are the maintainer-feedback half of F05. A
 * correction requires a note before it can be submitted -- "incorrect" with
 * no reason produces a feedback row nobody can learn from.
 *
 * A private escalation states plainly that acting on it publishes to GitHub.
 * DESIGN.md 12 makes publishing a suspected vulnerability prohibited by
 * default, so the consequence belongs on the button's own screen, not in a
 * doc the maintainer read yesterday.
 */
export function EscalationPreview({
  escalation,
  onApprove,
  onReject,
  onCorrect,
  onOpenInvestigation,
}: EscalationPreviewProps) {
  const [pending, setPending] = useState<PendingAction>(null)
  const [note, setNote] = useState('')
  const [showCorrect, setShowCorrect] = useState(false)

  if (!escalation) {
    return (
      <EmptyState
        description="Select an escalation from the queue to see the agent's reasoning and act on it."
        icon={MousePointerClick}
        title="Nothing selected"
      />
    )
  }

  const disabled = pending !== null || escalation.status !== 'pending'

  const run = async (action: PendingAction, fn: () => Promise<void>) => {
    setPending(action)
    try {
      await fn()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={escalation.severity} />
          <VisibilityBadge isPublic={escalation.isPublicVisibility} />
          {escalation.status !== 'pending' ? (
            <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
              {escalation.status}
            </span>
          ) : null}
        </div>
        <h2 className="text-lg font-semibold text-text-primary">
          {escalation.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="font-mono">{escalation.issueRef}</span>
          <span aria-hidden="true">·</span>
          <span>{escalation.category}</span>
          <span aria-hidden="true">·</span>
          <span>opened {formatRelativeTime(escalation.openedAt)}</span>
        </div>
        {/* Wrapped rather than passing className: ConfidenceIndicator is
            Stream C's file and does not accept one. Forking a duplicate or
            editing their component would both be worse. */}
        <div className="self-start">
          <ConfidenceIndicator score={escalation.confidence} />
        </div>
      </div>

      {!escalation.isPublicVisibility ? (
        <p className="rounded-lg border border-accent/40 bg-accent-muted px-3 py-2 text-sm text-text-secondary">
          This finding is private. Approving will post publicly to GitHub.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled}
          onClick={() => run('approve', () => onApprove(escalation.id))}
          type="button"
        >
          {pending === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
        <Button
          disabled={disabled}
          onClick={() => run('reject', () => onReject(escalation.id))}
          type="button"
          variant="outline"
        >
          {pending === 'reject' ? 'Rejecting…' : 'Reject'}
        </Button>
        <Button
          disabled={disabled}
          onClick={() => setShowCorrect((open) => !open)}
          type="button"
          variant="outline"
        >
          Correct
        </Button>
        <Button
          className="ml-auto"
          onClick={() => onOpenInvestigation(escalation.id)}
          type="button"
          variant="ghost"
        >
          <Search aria-hidden="true" className="size-4" />
          Open investigation
        </Button>
      </div>

      {showCorrect ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
          <label
            className="text-xs font-medium uppercase tracking-wide text-text-muted"
            htmlFor="correction-note"
          >
            What did the agent get wrong?
          </label>
          <textarea
            className="min-h-20 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-bright"
            id="correction-note"
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
          <div className="flex gap-2">
            <Button
              disabled={disabled || note.trim().length === 0}
              onClick={async () => {
                await run('correct', () =>
                  onCorrect(escalation.id, note.trim()),
                )
                setNote('')
                setShowCorrect(false)
              }}
              size="sm"
              type="button"
            >
              {pending === 'correct' ? 'Saving…' : 'Submit correction'}
            </Button>
            <Button
              onClick={() => setShowCorrect(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
