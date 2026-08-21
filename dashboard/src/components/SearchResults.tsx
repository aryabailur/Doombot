import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ExternalLink,
  Info,
  Loader2,
  MessageSquare,
  Search,
  ThumbsUp,
} from 'lucide-react'

import { searchIssues } from '@/lib/api'
import type { SearchResponse, SearchResult } from '@/lib/types'

interface SearchResultsProps {
  repoName: string
}

/** Split "owner/repo" for the path-segmented endpoint. */
function splitRepo(full: string): [string, string] {
  const [owner = '', repo = ''] = full.split('/')
  return [owner, repo]
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function shortDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * How the question was interpreted.
 *
 * Shown, not hidden, because it is the only way a reader can tell a filter that
 * found nothing from a filter that never ran. When query understanding is
 * unavailable the search still works on the literal text -- saying so is the
 * difference between a degraded feature and a broken one.
 */
function IntentSummary({ data }: { data: SearchResponse }) {
  const { intent, stats } = data
  const chips: string[] = []
  if (intent.state) chips.push(intent.state)
  if (intent.unanswered) chips.push('no replies')
  if (intent.created_after) chips.push(`after ${intent.created_after}`)
  if (intent.created_before) chips.push(`before ${intent.created_before}`)
  if (intent.author) chips.push(`by ${intent.author}`)
  if (intent.min_reactions) chips.push(`${intent.min_reactions}+ reactions`)
  for (const label of intent.labels) chips.push(label)
  if (intent.sort !== 'relevance') chips.push(`sorted by ${intent.sort}`)

  return (
    <section
      aria-label="How this search was interpreted"
      className="rounded-lg border-2 border-border bg-surface-2 p-3 shadow-brutal-sm"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Searched for
        </span>
        <span className="font-mono text-[13px] text-text-primary">
          {intent.semantic_query}
        </span>
      </div>

      {chips.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Filters
          </span>
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-[11px] text-text-muted">
        {stats.returned} of {stats.considered} candidates · {stats.indexed} issues indexed
        {stats.below_floor > 0 ? ` · ${stats.below_floor} too weak to show` : ''}
        {stats.filter_mode === 'post_filtered_dates' ? (
          <>
            {' '}
            ·{' '}
            <span className="text-warning">
              date window applied after retrieval — re-index this repository for an exact
              window
            </span>
          </>
        ) : null}
      </p>

      {!intent.understood ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
          <Info aria-hidden="true" className="mt-px size-3 shrink-0" />
          {intent.note || 'Searched the text as typed — no filters were applied.'}
        </p>
      ) : null}
    </section>
  )
}

/** The agent's own verdict on this issue. The column GitHub search cannot have. */
function AgentBadge({ result }: { result: SearchResult }) {
  const agent = result.agent
  if (!agent?.decision) return null

  const critical = agent.decision === 'escalate'
  const verdict = agent.decision.replace(/_/g, ' ')
  const confidence =
    typeof agent.confidence === 'number' ? ` · ${percent(agent.confidence)} confident` : ''

  const body = (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
        critical
          ? 'border-critical/40 bg-critical/10 text-critical'
          : 'border-information/40 bg-information/10 text-information'
      }`}
    >
      {critical ? <AlertTriangle aria-hidden="true" className="size-3" /> : null}
      Agent: {verdict}
      {confidence}
    </span>
  )

  return agent.investigation_id ? (
    <Link to={`/investigations/${agent.investigation_id}`} className="hover:underline">
      {body}
    </Link>
  ) : (
    body
  )
}

function ResultCard({ result, repoName }: { result: SearchResult; repoName: string }) {
  return (
    <li className="rounded-lg border-2 border-border bg-surface-1 p-3 shadow-brutal-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold text-text-primary">
          <a
            href={`https://github.com/${repoName}/issues/${result.number}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-baseline gap-1.5 hover:underline"
          >
            <span className="font-mono text-text-muted">#{result.number}</span>
            <span>{result.title}</span>
            <ExternalLink aria-hidden="true" className="size-3 shrink-0 self-center" />
          </a>
        </h3>
        {/* Similarity, not the blended rank: a reader comparing two rows wants
            "how close is this to what I asked", which is the honest number.
            The blend decides order and is shown on hover. */}
        <span
          title={`Similarity ${percent(result.score)} · rank score ${result.rank_score.toFixed(3)}`}
          className="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
        >
          {percent(result.score)} match
        </span>
      </div>

      {result.snippet ? (
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-text-secondary">
          {result.snippet}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
        <span
          className={`rounded border px-1.5 py-0.5 font-semibold ${
            result.state === 'open'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-border bg-surface-2 text-text-muted'
          }`}
        >
          {result.state || 'unknown'}
        </span>
        {result.author ? <span>{result.author}</span> : null}
        <span>{shortDate(result.created_at)}</span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare aria-hidden="true" className="size-3" />
          {result.comments}
        </span>
        <span className="inline-flex items-center gap-1">
          <ThumbsUp aria-hidden="true" className="size-3" />
          {result.reactions}
        </span>
        {result.labels.map((label) => (
          <span
            key={label}
            className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary"
          >
            {label}
          </span>
        ))}
        <AgentBadge result={result} />
      </div>
    </li>
  )
}

/**
 * The search results view. Replaces the page content, the way a code host's own
 * search does.
 *
 * The sidebar narrows what came back rather than re-querying: the initial
 * request already spent a model call and an embedding pass, and re-running it to
 * drop half the rows would be slower and would change the candidate set under
 * the reader. Every count shown is of the returned set, so nothing implies
 * knowledge of the whole index.
 */
export function SearchResults({ repoName }: SearchResultsProps) {
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''

  const [data, setData] = useState<SearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [stateFilter, setStateFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
  const [agentOnly, setAgentOnly] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setData(null)
      setError(null)
      return
    }
    const [owner, repo] = splitRepo(repoName)
    if (!owner || !repo) return

    // Drop a stale response: switching repository or retyping mid-flight would
    // otherwise let an older, slower search overwrite a newer one.
    let live = true
    setLoading(true)
    setError(null)
    setStateFilter('all')
    setLabelFilter(null)
    setAgentOnly(false)

    searchIssues(owner, repo, query, 20)
      .then((response) => {
        if (live) setData(response)
      })
      .catch((cause: unknown) => {
        if (!live) return
        setError(
          cause instanceof Error ? cause.message : 'Search failed. Is the API running?',
        )
      })
      .finally(() => {
        if (live) setLoading(false)
      })

    return () => {
      live = false
    }
  }, [query, repoName])

  const labels = useMemo(() => {
    const counts = new Map<string, number>()
    for (const result of data?.results ?? []) {
      for (const label of result.labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [data])

  const visible = useMemo(() => {
    return (data?.results ?? []).filter((result) => {
      if (stateFilter !== 'all' && result.state !== stateFilter) return false
      if (labelFilter && !result.labels.includes(labelFilter)) return false
      if (agentOnly && !result.agent?.decision) return false
      return true
    })
  }, [data, stateFilter, labelFilter, agentOnly])

  if (!query.trim()) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-10 text-center">
        <Search aria-hidden="true" className="size-6 text-text-muted" />
        <p className="text-sm font-semibold text-text-primary">
          Ask about {repoName} in plain English
        </p>
        <p className="max-w-md text-[13px] text-text-muted">
          Results come from this repository's indexed history, matched by meaning
          rather than by keyword. Press <span className="font-mono">/</span> to focus the
          search box.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <Loader2 aria-hidden="true" className="size-5 animate-spin text-accent" />
        <p className="text-sm text-text-secondary">Reading your question…</p>
        <p className="text-[11px] text-text-muted">
          Interpreting the query, then searching {repoName}'s indexed issues.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border-2 border-critical/40 bg-critical/5 p-4">
        <p className="text-sm font-semibold text-critical">Search failed</p>
        <p className="mt-1 text-[13px] text-text-secondary">{error}</p>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="flex flex-col gap-3">
      <IntentSummary data={data} />

      {data.stats.indexed === 0 ? (
        <div className="rounded-lg border-2 border-border bg-surface-1 p-4 shadow-brutal-sm">
          <p className="text-sm font-semibold text-text-primary">
            {repoName} has no indexed issues yet
          </p>
          <p className="mt-1 text-[13px] text-text-muted">
            Search reads the RAG index, not GitHub directly. Index this repository from
            the toolbar and the same query will work.
          </p>
        </div>
      ) : data.results.length === 0 ? (
        <div className="rounded-lg border-2 border-border bg-surface-1 p-4 shadow-brutal-sm">
          <p className="text-sm font-semibold text-text-primary">Nothing matched</p>
          <p className="mt-1 text-[13px] text-text-muted">
            {data.stats.indexed} issues were searched. Try removing a filter, or asking
            in broader terms.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          {/* Narrows what came back. Counts are of the returned set, not the
              index -- claiming otherwise would be a number we do not have. */}
          <aside className="shrink-0 lg:w-48">
            <div className="rounded-lg border-2 border-border bg-surface-1 p-3 shadow-brutal-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Narrow these {data.results.length}
              </p>

              <fieldset className="mt-2">
                <legend className="text-[11px] font-semibold text-text-secondary">State</legend>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['all', 'open', 'closed'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={stateFilter === option}
                      onClick={() => setStateFilter(option)}
                      className={`rounded border px-1.5 py-0.5 text-[11px] ${
                        stateFilter === option
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border bg-surface-2 text-text-secondary'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>

              {labels.length ? (
                <fieldset className="mt-3">
                  <legend className="text-[11px] font-semibold text-text-secondary">
                    Label
                  </legend>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {labels.map(([label, count]) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={labelFilter === label}
                        onClick={() => setLabelFilter(labelFilter === label ? null : label)}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                          labelFilter === label
                            ? 'border-accent bg-accent text-accent-foreground'
                            : 'border-border bg-surface-2 text-text-secondary'
                        }`}
                      >
                        {label} {count}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <label className="mt-3 flex items-center gap-2 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={agentOnly}
                  onChange={(event) => setAgentOnly(event.target.checked)}
                />
                Triaged by the agent
              </label>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {visible.length === 0 ? (
              <p className="rounded-lg border-2 border-border bg-surface-1 p-4 text-[13px] text-text-muted shadow-brutal-sm">
                No result matches those filters. Clear one to see the rest.
              </p>
            ) : (
              <ul className="flex list-none flex-col gap-2 p-0">
                {visible.map((result) => (
                  <ResultCard
                    key={`${result.number}-${result.score}`}
                    repoName={data.repo_name}
                    result={result}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
