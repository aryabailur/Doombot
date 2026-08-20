import { Inbox, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

/**
 * Shared empty-result primitive.
 *
 * Every screen routes its "query succeeded, zero items" state through this
 * so the copy stays consistent. Never renders a bare "No data" -- a title
 * plus a sentence of explanation is the minimum, per DESIGN.md 10.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface-1 px-6 py-12 text-center',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-8 text-text-muted" />
      <div className="space-y-1">
        <p className="text-base font-semibold text-text-primary">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <Button className="mt-1" onClick={action.onClick} type="button">
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
