import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '@/lib/api'
import type { ErrorKind } from '@/components/ErrorState'

export interface AsyncState<T> {
  /** null while the first load is in flight -- distinct from an empty result. */
  data: T | null
  /** Set when the last attempt failed. Data from a prior success is kept. */
  error: ErrorKind | null
  /** True during a refetch that already has data behind it. */
  refreshing: boolean
  reload: () => void
}

/**
 * Map a failure onto the shared ErrorState vocabulary.
 *
 * ErrorState exists so every screen words the same failure identically; this
 * is the one place that decides which wording a given failure gets.
 */
function classify(error: unknown): ErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      // The API returns 403 when the GitHub token lacks a scope, which reads
      // to a maintainer as a permission problem, not an auth one.
      return error.status === 401 ? 'auth' : 'permission_denied'
    }
    if (error.status === 429) {
      return 'rate_limited'
    }
    if (error.status >= 500) {
      return 'agent_failure'
    }
  }
  // fetch() rejects with a TypeError when the host is unreachable, which is
  // the overwhelmingly common case during development.
  return 'network'
}

/**
 * Fetch once, expose the states the UI actually needs, optionally poll.
 *
 * Deliberately not react-query: the dashboard has five screens and no cache
 * invalidation story, and a dependency that large earns its place only when
 * there is something to invalidate.
 *
 * `data` staying non-null across a failed refetch is the point -- it is what
 * lets a screen show stale data with an error banner rather than blanking,
 * which dashboard/CLAUDE.md 7 lists as a required state.
 */
export function useApiData<T>(
  fetcher: () => Promise<T>,
  options: { pollMs?: number; fallback?: T; refreshKey?: number | string } = {},
): AsyncState<T> {
  /**
   * `refreshKey` exists because the fetcher is deliberately held in a ref, so
   * changing it cannot retrigger a load. Polling alone means a screen can sit
   * up to `pollMs` behind reality -- and when an investigation finishes, the
   * data every panel is showing has just changed. Bumping this key refetches
   * at that moment instead of waiting out the interval.
   */
  const { pollMs, fallback, refreshKey } = options

  const [data, setData] = useState<T | null>(fallback ?? null)
  const [error, setError] = useState<ErrorKind | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Held in a ref so a caller passing an inline arrow does not restart the
  // poll on every render.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const hasData = data !== null

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      setData(await fetcherRef.current())
      setError(null)
    } catch (caught) {
      setError(classify(caught))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    if (!pollMs) {
      return
    }
    const timer = setInterval(() => void load(), pollMs)
    return () => clearInterval(timer)
  }, [load, pollMs, refreshKey])

  return {
    // A fallback is shown only until the first real response lands, so the
    // demo never opens on an empty screen but also never keeps showing
    // fixtures once the API answers.
    data: hasData ? data : (fallback ?? null),
    error,
    refreshing,
    reload: () => void load(),
  }
}
