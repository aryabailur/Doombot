import { DatabaseZap, FolderGit2, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Repository shape this component needs.
 *
 * `RepoSummary` does not exist in `src/lib/types.ts` yet -- that file mirrors
 * `api/schemas.py` and is Stream C's to edit (dashboard/CLAUDE.md 2). Rather
 * than fork a competing type there, the shape is declared here and should be
 * replaced with an import once C adds the canonical one.
 */
export interface RepoSummary {
  repo_name: string
  health_score: number | null
  open_investigations: number
  last_scan: string | null
}

export interface RepositorySelectorProps {
  repos: RepoSummary[]
  selectedRepo?: RepoSummary
  onSelect: (repo: RepoSummary) => void
  onIndexRequested: (repo: RepoSummary) => Promise<void>
  isIndexing?: boolean
  className?: string
}

/**
 * Repository picker plus the index action (F01).
 *
 * A native <select> rather than a custom dropdown: it is keyboard operable
 * and screen-reader correct for free, and dashboard/CLAUDE.md 8 asks for a
 * real combobox pattern instead of divs with click handlers.
 *
 * Indexing renders as an icon *and* the word "Indexing", never a bare
 * spinner. A repo mid-index is functionally in the "RAG index unavailable"
 * state for any investigation UI depending on it, so it has to be legible.
 */
export function RepositorySelector({
  repos,
  selectedRepo,
  onSelect,
  onIndexRequested,
  isIndexing = false,
  className,
}: RepositorySelectorProps) {
  if (repos.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 text-xs', className)}>
        <FolderGit2 aria-hidden="true" className="size-4 text-text-muted" />
        <span className="text-text-muted">No repositories connected</span>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label className="sr-only" htmlFor="repository-select">
        Repository
      </label>
      <FolderGit2 aria-hidden="true" className="size-4 shrink-0 text-accent" />
      <select
        className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-bright"
        id="repository-select"
        onChange={(event) => {
          const next = repos.find(
            (repo) => repo.repo_name === event.target.value,
          )
          if (next) {
            onSelect(next)
          }
        }}
        value={selectedRepo?.repo_name ?? ''}
      >
        {repos.map((repo) => (
          <option key={repo.repo_name} value={repo.repo_name}>
            {repo.repo_name}
          </option>
        ))}
      </select>

      {selectedRepo ? (
        <Button
          aria-label={`Index ${selectedRepo.repo_name}`}
          className="h-9"
          disabled={isIndexing}
          onClick={() => {
            void onIndexRequested(selectedRepo)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {isIndexing ? (
            <>
              <Loader2
                aria-hidden="true"
                className="size-4 motion-safe:animate-spin"
              />
              Indexing…
            </>
          ) : (
            <>
              <DatabaseZap aria-hidden="true" className="size-4" />
              Index
            </>
          )}
        </Button>
      ) : null}
    </div>
  )
}
