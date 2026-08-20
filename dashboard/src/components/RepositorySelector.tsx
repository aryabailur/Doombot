import { useState } from 'react'

import { DatabaseZap, FolderGit2, Loader2, Plus } from 'lucide-react'

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
  /**
   * Add a repository by name. Resolves once it has been accepted, so the
   * caller owns indexing and error reporting.
   */
  onAddRepository?: (repoName: string) => Promise<void>
  isIndexing?: boolean
  className?: string
}

/**
 * GitHub's own rule: owner and repo may hold letters, digits, dot, dash and
 * underscore, and neither half may be empty. Deliberately permissive about
 * what it *accepts* and strict about the shape, so a typo is caught here
 * rather than surfacing as a 404 from three endpoints later.
 */
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/

/**
 * Accept a full GitHub URL as well as `owner/repo`.
 *
 * People copy the address bar -- that is the natural gesture, and rejecting
 * it for not being `owner/repo` would be a pointless obstacle. Trailing
 * `.git`, slashes, and query strings are all stripped.
 */
export function normalizeRepoInput(raw: string): string | null {
  let value = raw.trim()
  if (!value) {
    return null
  }

  value = value.replace(/^https?:\/\/(www\.)?github\.com\//i, '')
  value = value.replace(/^git@github\.com:/i, '')
  value = value.replace(/[?#].*$/, '')
  value = value.replace(/\.git$/i, '')
  value = value.replace(/^\/+|\/+$/g, '')

  // A URL may carry more path than owner/repo (…/issues/4, …/tree/main).
  const parts = value.split('/').filter(Boolean)
  if (parts.length > 2) {
    value = `${parts[0]}/${parts[1]}`
  }

  return REPO_PATTERN.test(value) ? value : null
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
  onAddRepository,
  isIndexing = false,
  className,
}: RepositorySelectorProps) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const normalized = normalizeRepoInput(draft)
    if (!normalized) {
      setError('Enter owner/repo, or paste a GitHub URL.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await onAddRepository?.(normalized)
      setDraft('')
      setAdding(false)
    } catch (cause) {
      // Surfaced inline rather than thrown away: "nothing happened" is the
      // worst possible response to a repo that could not be reached.
      setError(
        cause instanceof Error ? cause.message : 'Could not add that repository.',
      )
    } finally {
      setBusy(false)
    }
  }

  const addForm = onAddRepository ? (
    adding ? (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label className="sr-only" htmlFor="add-repository">
          Repository to add
        </label>
        <input
          aria-describedby={error ? 'add-repository-error' : undefined}
          aria-invalid={error ? true : undefined}
          autoFocus
          className="h-9 w-56 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-accent-bright"
          disabled={busy}
          id="add-repository"
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setAdding(false)
              setDraft('')
              setError(null)
            }
          }}
          placeholder="owner/repo"
          value={draft}
        />
        <Button className="h-9" disabled={busy} size="sm" type="submit">
          {busy ? (
            <>
              <Loader2
                aria-hidden="true"
                className="size-4 motion-safe:animate-spin"
              />
              Adding…
            </>
          ) : (
            'Add'
          )}
        </Button>
        <Button
          className="h-9"
          disabled={busy}
          onClick={() => {
            setAdding(false)
            setDraft('')
            setError(null)
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        {error ? (
          <span
            className="text-xs text-critical"
            id="add-repository-error"
            role="alert"
          >
            {error}
          </span>
        ) : null}
      </form>
    ) : (
      <Button
        className="h-9"
        onClick={() => setAdding(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" className="size-4" />
        Add repository
      </Button>
    )
  ) : null

  if (repos.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 text-xs', className)}>
        <FolderGit2 aria-hidden="true" className="size-4 text-text-muted" />
        <span className="text-text-muted">No repositories connected</span>
        {addForm}
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
      {addForm}
    </div>
  )
}
