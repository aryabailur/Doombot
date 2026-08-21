/**
 * Unauthenticated GitHub REST reads.
 *
 * No token is bundled or required: the public API allows 60 requests/hour per
 * IP, which is enough to analyse a repository on demand. A token, if the user
 * configures one in the options page, raises that to 5,000 and is read from
 * chrome.storage.local -- never hard-coded (spec section 42).
 *
 * Every method either returns data or throws GitHubError. Callers decide
 * whether to fall back to demo data; this layer never invents repository
 * intelligence.
 */

import type { IssueRecord, PullRequestRecord } from '@/lib/types'

const API = 'https://api.github.com'

/** Rate-limit and not-found are recoverable; the UI offers demo data instead. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly recoverable: boolean,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

type GitHubIssue = {
  number: number
  title: string
  body: string | null
  labels: Array<{ name: string } | string>
  state: string
  created_at: string
  updated_at: string
  comments: number
  pull_request?: unknown
  user?: { login: string } | null
}

type GitHubRepo = {
  open_issues_count: number
  default_branch: string
  pushed_at: string
  stargazers_count: number
}

/**
 * Responses are cached for the session. GitHub's unauthenticated budget is 60
 * requests/hour, and re-opening the Lens on the same page must not spend it
 * again -- without this, a few navigations exhaust the quota mid-demo.
 */
const cache = new Map<string, { at: number; value: Promise<unknown> }>()
const TTL_MS = 5 * 60 * 1000

function subsystemOf(text: string, labels: string[]): string {
  // Keyword buckets rather than an LLM call: this runs in the service worker
  // with no network budget, and the retrieval ranker only needs a coarse
  // grouping to boost same-subsystem matches.
  const haystack = `${text} ${labels.join(' ')}`.toLowerCase()
  const buckets: Array<[string, string[]]> = [
    ['authentication', ['auth', 'oauth', 'token', 'login', 'session', 'jwt', 'credential', 'password']],
    ['database', ['database', 'migration', 'sql', 'postgres', 'mysql', 'query', 'schema']],
    ['routing', ['route', 'routing', 'rate limit', 'retry', 'request', 'endpoint', 'http']],
    ['installation', ['install', 'setup', 'build', 'compile', 'dependency', 'npm', 'pip']],
    ['performance', ['slow', 'performance', 'memory', 'leak', 'timeout', 'hang', 'freeze', 'cpu']],
    ['ui', ['ui', 'css', 'render', 'layout', 'style', 'button', 'display']],
    ['documentation', ['doc', 'documentation', 'readme', 'typo', 'example']],
  ]
  for (const [name, keywords] of buckets) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return name
  }
  return 'general'
}

/** Short noun-ish phrases the retrieval ranker can overlap between issues. */
function symptomsOf(title: string, body: string): string[] {
  const patterns = [
    /\b(?:fails?|failing|failed)\b[^.,;\n]{0,40}/gi,
    /\b(?:errors?|exceptions?|crashe?s?|panics?)\b[^.,;\n]{0,40}/gi,
    /\b(?:hangs?|freezes?|stuck|blocks?|times? out)\b[^.,;\n]{0,40}/gi,
    /\b(?:cannot|can't|unable to|does ?n[o']t)\b[^.,;\n]{0,40}/gi,
    /\b(?:expires?|expiring|expired|invalid|rejected)\b[^.,;\n]{0,40}/gi,
  ]
  const found = new Set<string>()
  const text = `${title}. ${body}`.slice(0, 2000)
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const phrase = match[0].trim().toLowerCase().replace(/\s+/g, ' ')
      if (phrase.length > 4) found.add(phrase)
      if (found.size >= 6) break
    }
  }
  return found.size > 0 ? [...found] : [title.toLowerCase().slice(0, 60)]
}

/** Environment lines are what follow-up decisions check for; absence is signal. */
function environmentOf(body: string): string | undefined {
  const match = body.match(
    /\b(?:windows|macos|mac os|ubuntu|debian|linux|android|ios)\b[^.,;\n]{0,20}|\bnode(?:\.js)? ?v?\d+[\d.]*|\bpython ?\d[\d.]*|\bpostgres(?:ql)? ?\d+/i,
  )
  return match ? match[0].trim() : undefined
}

function labelNames(labels: GitHubIssue['labels']): string[] {
  return labels.map((label) => (typeof label === 'string' ? label : label.name)).filter(Boolean)
}

export function toIssueRecord(issue: GitHubIssue): IssueRecord {
  const body = issue.body ?? ''
  const labels = labelNames(issue.labels)
  return {
    number: issue.number,
    title: issue.title,
    body,
    subsystem: subsystemOf(`${issue.title} ${body}`, labels),
    labels,
    environment: environmentOf(body),
    symptoms: symptomsOf(issue.title, body),
  }
}

export class GitHubClient {
  constructor(private readonly token?: string) {}

  private get<T>(path: string): Promise<T> {
    const key = `${this.token ? 'auth' : 'anon'}:${path}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>

    // The promise is cached before it settles, so concurrent callers for the
    // same path share one request instead of each spending rate-limit budget.
    const pending = this.fetchJson<T>(path).catch((error: unknown) => {
      cache.delete(key)
      throw error
    })
    cache.set(key, { at: Date.now(), value: pending })
    return pending
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`

    let response: Response
    try {
      response = await fetch(`${API}${path}`, { headers })
    } catch {
      // Offline, DNS failure, or the venue's wifi captive portal.
      throw new GitHubError('GitHub is unreachable.', 0, true)
    }

    if (!response.ok) {
      // 403 with a zeroed budget is the rate limit; 403 otherwise is access.
      const remaining = response.headers.get('x-ratelimit-remaining')
      if (response.status === 403 && remaining === '0') {
        throw new GitHubError(
          'GitHub rate limit reached. Add a token in options to raise it to 5,000 requests/hour.',
          403,
          true,
        )
      }
      if (response.status === 404) {
        throw new GitHubError('Repository or issue not found on GitHub.', 404, true)
      }
      throw new GitHubError(`GitHub returned ${response.status}.`, response.status, true)
    }

    return (await response.json()) as T
  }

  async getRepo(owner: string, repo: string) {
    return this.get<GitHubRepo>(`/repos/${owner}/${repo}`)
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<IssueRecord> {
    return toIssueRecord(await this.get<GitHubIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`))
  }

  /**
   * Recent issues, excluding pull requests.
   *
   * GitHub's /issues endpoint returns PRs too -- they carry a `pull_request`
   * key. Leaving them in would let a PR be reported as a duplicate issue.
   */
  async listIssues(
    owner: string,
    repo: string,
    limit = 100,
    state: 'all' | 'open' = 'all',
  ): Promise<IssueRecord[]> {
    const raw = await this.get<GitHubIssue[]>(
      `/repos/${owner}/${repo}/issues?state=${state}&per_page=${Math.min(limit, 100)}&sort=updated`,
    )
    return raw.filter((issue) => !issue.pull_request).map(toIssueRecord)
  }

  async listPulls(owner: string, repo: string, limit = 30) {
    return this.get<Array<{ number: number; title: string; state: string; created_at: string; merged_at: string | null }>>(
      `/repos/${owner}/${repo}/pulls?state=all&per_page=${Math.min(limit, 100)}`,
    )
  }

  async getPull(owner: string, repo: string, pullNumber: number): Promise<PullRequestRecord> {
    const pull = await this.get<{ number: number; title: string; body: string | null }>(
      `/repos/${owner}/${repo}/pulls/${pullNumber}`,
    )
    const files = await this.get<Array<{ filename: string }>>(
      `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`,
    )
    const paths = files.map((file) => file.filename)
    return {
      number: pull.number,
      title: pull.title,
      files: paths,
      subsystem: subsystemOf(`${pull.title} ${paths.join(' ')}`, []),
    }
  }

  /**
   * Total commit count on the default branch.
   *
   * GitHub has no count endpoint, but requesting one commit per page puts the
   * total in the Link header's `last` rel -- one cheap request instead of
   * paginating the whole history.
   */
  async countCommits(owner: string, repo: string): Promise<number> {
    const key = `${this.token ? 'auth' : 'anon'}:commitcount:${owner}/${repo}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<number>

    const pending = (async () => {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      if (this.token) headers.Authorization = `Bearer ${this.token}`
      const response = await fetch(`${API}/repos/${owner}/${repo}/commits?per_page=1`, { headers })
      if (!response.ok) return 0
      const link = response.headers.get('link') ?? ''
      const last = /[?&]page=(\d+)>; rel="last"/.exec(link)
      if (last) return Number(last[1])
      // No Link header means a single page: count what came back.
      const body = (await response.json()) as unknown[]
      return Array.isArray(body) ? body.length : 0
    })().catch(() => 0)

    cache.set(key, { at: Date.now(), value: pending })
    return pending
  }

  async listContributors(owner: string, repo: string) {
    return this.get<Array<{ login: string; contributions: number }>>(
      `/repos/${owner}/${repo}/contributors?per_page=100`,
    )
  }

  static clearCache() {
    cache.clear()
  }
}
