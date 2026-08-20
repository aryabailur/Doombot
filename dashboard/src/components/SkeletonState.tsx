import { cn } from '@/lib/utils'

export interface SkeletonStateProps {
  variant: 'list' | 'card' | 'table-row' | 'text'
  count?: number
  className?: string
}

/**
 * Shared loading placeholder.
 *
 * Each variant matches the shape of the content it stands in for, so the
 * layout does not jump when real data arrives.
 *
 * The pulse is `motion-safe:animate-pulse`, so a reduced-motion user gets a
 * static block instead. Per dashboard/CLAUDE.md 8 that is a requirement, not
 * a nicety -- and a static block still communicates "loading" perfectly well.
 */
const variantRows = {
  list: 4,
  card: 1,
  'table-row': 5,
  text: 3,
} satisfies Record<SkeletonStateProps['variant'], number>

function Block({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface-2 motion-safe:animate-pulse',
        className,
      )}
    />
  )
}

export function SkeletonState({
  variant,
  count,
  className,
}: SkeletonStateProps) {
  const rows = count ?? variantRows[variant]

  return (
    // aria-busy + a visually hidden label so a screen reader announces the
    // wait instead of encountering a silent pile of empty divs.
    <div aria-busy="true" className={cn('space-y-3', className)} role="status">
      <span className="sr-only">Loading</span>

      {Array.from({ length: rows }, (_, index) => {
        if (variant === 'card') {
          return (
            <div
              className="space-y-3 rounded-xl border border-border bg-surface-1 p-4"
              key={index}
            >
              <Block className="h-4 w-1/3" />
              <Block className="h-8 w-1/2" />
              <Block className="h-3 w-full" />
              <Block className="h-3 w-4/5" />
            </div>
          )
        }

        if (variant === 'table-row') {
          return (
            <div className="flex items-center gap-3" key={index}>
              <Block className="h-5 w-16 shrink-0" />
              <Block className="h-4 flex-1" />
              <Block className="h-4 w-24 shrink-0" />
            </div>
          )
        }

        if (variant === 'list') {
          return (
            <div
              className="flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-3"
              key={index}
            >
              <Block className="mt-0.5 size-4 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Block className="h-4 w-2/3" />
                <Block className="h-3 w-1/3" />
              </div>
            </div>
          )
        }

        return (
          <Block
            className={cn('h-3', index === rows - 1 ? 'w-2/3' : 'w-full')}
            key={index}
          />
        )
      })}
    </div>
  )
}
