import { useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'

import {
  AgentActivityFeed,
  type ActivityItem,
} from '@/components/AgentActivityFeed'
import { AgentStatusIndicator } from '@/components/AgentStatusIndicator'
import { AppShell } from '@/components/AppShell'
import { ErrorState } from '@/components/ErrorState'
import {
  EscalationTable,
  type EscalationFilters,
  type EscalationRow,
} from '@/components/EscalationTable'
import { EscalationPreview } from '@/components/EscalationPreview'
import {
  HealthMetricBreakdown,
  type HealthComponentScore,
} from '@/components/HealthMetricBreakdown'
import { HealthScoreCard } from '@/components/HealthScoreCard'
import { HealthTrendChart } from '@/components/HealthTrendChart'
import { InvestigationList } from '@/components/InvestigationList'
import { InvestigationTrace } from '@/components/InvestigationTrace'
import { IssueGraph } from '@/components/IssueGraph'
import { RepositorySelector } from '@/components/RepositorySelector'
import { SkeletonState } from '@/components/SkeletonState'
import {
  getInvestigation,
  getRepoGraph,
  getRepoHealth,
  getRepos,
  indexRepo,
  listEscalations,
  listInvestigations,
  postFeedback,
} from '@/lib/api'
import type { Escalation, HealthResponse } from '@/lib/types'
import { useApiData } from '@/lib/useApiData'
import { useSocket } from '@/lib/useSocket'

const WS_URL = 'ws://localhost:8000/ws'

/** Split "owner/repo" for the path-segmented endpoints. */
function splitRepo(full: string): [string, string] {
  const [owner = '', repo = ''] = full.split('/')
  return [owner, repo]
}

/**
 * Map an API escalation onto the table's row shape.
 *
 * The wire contract carries no per-escalation confidence or visibility flag,
 * so both are derived: severity implies a confidence band, and a critical
 * escalation is treated as private because DESIGN.md 12 prohibits publishing a
 * suspected vulnerability without approval. Deriving here rather than widening
 * the contract keeps `schemas.py` and `types.ts` in step.
 */
function toRow(item: Escalation): EscalationRow {
  const known = ['critical', 'high', 'warning', 'info'] as const
  const severity = (known as readonly string[]).includes(item.severity)
    ? (item.severity as EscalationRow['severity'])
    : 'info'

  return {
    id: item.investigation_id,
    severity,
    category: severity === 'critical' ? 'security' : 'triage',
    title: item.title || `Issue #${item.number}`,
    issueRef: `#${item.number}`,
    confidence: severity === 'critical' ? 0.9 : severity === 'high' ? 0.75 : 0.6,
    openedAt: item.created_at,
    status: 'pending',
    isPublicVisibility: severity !== 'critical',
  }
}

/** The four sub-scores the backend sends, as weighted components for the UI. */
function toComponents(health: HealthResponse): HealthComponentScore[] {
  const meta: Record<string, { label: string; weight: number }> = {
    security: { label: 'Security posture', weight: 0.3 },
    responsiveness: { label: 'Response health', weight: 0.3 },
    staleness: { label: 'Backlog freshness', weight: 0.25 },
    duplication: { label: 'Duplicate rate', weight: 0.15 },
  }
  return Object.entries(health.breakdown).map(([key, score]) => ({
    key: key as HealthComponentScore['key'],
    label: meta[key]?.label ?? key,
    weight: meta[key]?.weight ?? 0,
    score: score as number,
  }))
}

function OverviewPage({ repoName }: { repoName: string }) {
  const [owner, repo] = splitRepo(repoName)
  const health = useApiData<HealthResponse>(() => getRepoHealth(owner, repo), {
    pollMs: 60_000,
  })
  const escalations = useApiData(() => listEscalations(), { pollMs: 20_000 })
  const investigations = useApiData(() => listInvestigations(), {
    pollMs: 20_000,
  })

  const rows = (escalations.data ?? []).map(toRow)
  const critical = rows.filter((row) => row.severity === 'critical').length

  // Activity is derived from investigation history rather than a dedicated
  // endpoint: every investigation already records what it decided and when.
  const activity: ActivityItem[] = (investigations.data ?? []).map((item) => ({
    id: item.investigation_id,
    message: `${(item.decision ?? item.status).replace(/_/g, ' ')} — #${item.number}`,
    timestamp: item.completed_at ?? item.created_at,
    kind:
      item.decision === 'escalate'
        ? 'escalation'
        : item.decision
          ? 'action_taken'
          : 'investigation',
  }))

  if (health.error && !health.data) {
    return <ErrorState kind={health.error} onRetry={health.reload} />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {health.data ? (
          <HealthScoreCard
            components={toComponents(health.data)}
            overallScore={health.data.score}
          />
        ) : (
          <SkeletonState variant="card" />
        )}

        <section
          aria-label="Escalation summary"
          className="flex flex-col justify-center gap-3 rounded-xl border border-border bg-surface-1 p-4"
        >
          <div>
            <p className="text-3xl font-semibold tabular-nums text-critical">
              {critical}
            </p>
            <p className="text-xs text-text-muted">critical escalations</p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums text-warning">
              {rows.length}
            </p>
            <p className="text-xs text-text-muted">awaiting a maintainer</p>
          </div>
        </section>

        <AgentActivityFeed items={activity} maxItems={6} />
      </div>

      <HealthTrendChart
        data={(health.data?.history ?? []).map((point) => ({
          date: point.ts,
          score: point.score,
        }))}
      />
    </div>
  )
}

function EscalationsPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<EscalationFilters>({})
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [decided, setDecided] = useState<
    Record<string, EscalationRow['status']>
  >({})

  const escalations = useApiData(() => listEscalations(), { pollMs: 20_000 })

  const rows = (escalations.data ?? []).map((item) => {
    const row = toRow(item)
    // Local status overlay: POST /api/feedback records the verdict but does
    // not mutate the escalation row, so the UI reflects the action itself.
    return decided[row.id] ? { ...row, status: decided[row.id] } : row
  })
  const selected = rows.find((row) => row.id === selectedId) ?? null

  const submit = async (
    id: string,
    verdict: 'up' | 'down',
    status: EscalationRow['status'],
    note?: string,
  ) => {
    try {
      await postFeedback({ investigation_id: id, verdict, note })
    } finally {
      // Reflect the choice even if the write failed. The maintainer made a
      // decision; silently discarding it is worse than a stale flag.
      setDecided((current) => ({ ...current, [id]: status }))
    }
  }

  if (escalations.error && !escalations.data) {
    return <ErrorState kind={escalations.error} onRetry={escalations.reload} />
  }
  if (!escalations.data) {
    return <SkeletonState count={4} variant="list" />
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <EscalationTable
        filters={filters}
        onFiltersChange={setFilters}
        onSelect={setSelectedId}
        rows={rows}
        selectedId={selectedId}
      />
      <EscalationPreview
        escalation={selected}
        onApprove={(id) => submit(id, 'up', 'approved')}
        onCorrect={(id, note) => submit(id, 'down', 'corrected', note)}
        onOpenInvestigation={(id) => navigate(`/investigations/${id}`)}
        onReject={(id) => submit(id, 'down', 'rejected')}
      />
    </div>
  )
}

function InvestigationsPage() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const investigations = useApiData(() => listInvestigations(), {
    pollMs: 15_000,
  })

  return (
    <InvestigationList
      error={investigations.error ? 'Could not load investigations' : null}
      investigations={investigations.data}
      onRetry={investigations.reload}
      onSelect={(id) => {
        setSelectedId(id)
        navigate(`/investigations/${id}`)
      }}
      selectedId={selectedId}
    />
  )
}

/**
 * Investigation detail -- the hero surface (F02).
 *
 * InvestigationTrace owns its own socket subscription and resync, so this page
 * only fetches the initial chain and hands over. Merging live steps here as
 * well would mean two components tracking the same state and disagreeing about
 * it -- and `onResync` is what makes the trace refresh-proof
 * (dashboard/CLAUDE.md 10: REST wins, the socket is an overlay).
 */
function InvestigationDetailPage() {
  const { id = '' } = useParams()
  const detail = useApiData(() => getInvestigation(id), {})

  if (detail.error && !detail.data) {
    return <ErrorState kind={detail.error} onRetry={detail.reload} />
  }
  if (!detail.data) {
    return <SkeletonState count={5} variant="list" />
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="rounded-xl border border-border bg-surface-1 p-4">
        <h1 className="text-lg font-semibold text-text-primary">
          {detail.data.title}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {detail.data.decision_reason ?? 'Investigation in progress.'}
        </p>
        <p className="mt-2 text-xs text-text-muted">
          {detail.data.repo_name}#{detail.data.number} · {detail.data.status}
          {detail.data.decision ? ` · ${detail.data.decision}` : ''}
        </p>
      </header>
      <InvestigationTrace
        initialSteps={detail.data.steps}
        investigationId={id}
        live={detail.data.status !== 'done'}
        onResync={async () => (await getInvestigation(id)).steps}
      />
    </div>
  )
}

function GraphPage({ repoName }: { repoName: string }) {
  const navigate = useNavigate()
  const [owner, repo] = splitRepo(repoName)
  const graph = useApiData(() => getRepoGraph(owner, repo), {})

  if (graph.error && !graph.data) {
    return <ErrorState kind={graph.error} onRetry={graph.reload} />
  }
  if (!graph.data) {
    return <SkeletonState variant="card" />
  }

  return (
    <IssueGraph
      links={graph.data.links}
      nodes={graph.data.nodes}
      onSelectIssue={(node) => navigate(`/investigations/issue-${node.number}`)}
    />
  )
}

function HealthPage({ repoName }: { repoName: string }) {
  const [owner, repo] = splitRepo(repoName)
  const health = useApiData<HealthResponse>(() => getRepoHealth(owner, repo), {
    pollMs: 60_000,
  })

  if (health.error && !health.data) {
    return <ErrorState kind={health.error} onRetry={health.reload} />
  }
  if (!health.data) {
    return <SkeletonState variant="card" />
  }

  const components = toComponents(health.data)

  return (
    <div className="flex flex-col gap-4">
      <HealthScoreCard
        components={components}
        overallScore={health.data.score}
      />
      <section
        aria-label="Health component breakdown"
        className="rounded-xl border border-border bg-surface-1 p-4"
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Component scores
        </h2>
        <HealthMetricBreakdown components={components} />
      </section>
      <HealthTrendChart
        data={health.data.history.map((point) => ({
          date: point.ts,
          score: point.score,
        }))}
      />
    </div>
  )
}

export function App() {
  // One repository per session. A selector exists, but every endpoint is
  // per-repo and nothing needs cross-repo aggregation yet.
  const [repoName, setRepoName] = useState('aryabailur/Doombot')
  const [indexing, setIndexing] = useState(false)
  const [owner, repo] = splitRepo(repoName)

  const repos = useApiData(() => getRepos(), {})

  // One socket for the shell, purely to drive the connection indicator. The
  // detail page opens its own for step events -- the hub broadcasts to every
  // client, so a second connection costs nothing and keeps the pages
  // independent.
  const { connectionState, lastEventAt } = useSocket({
    url: WS_URL,
    onEvent: () => {},
  })

  return (
    <BrowserRouter>
      <AppShell
        toolbar={
          <>
            <RepositorySelector
              isIndexing={indexing}
              onIndexRequested={async () => {
                setIndexing(true)
                try {
                  await indexRepo(owner, repo)
                } finally {
                  setIndexing(false)
                }
              }}
              onSelect={(next) => setRepoName(next.repo_name)}
              repos={
                repos.data?.length
                  ? repos.data
                  : [
                      {
                        repo_name: repoName,
                        health_score: 0,
                        open_investigations: 0,
                        last_scan: null,
                      },
                    ]
              }
              selectedRepo={repos.data?.find(
                (item) => item.repo_name === repoName,
              )}
            />
            <AgentStatusIndicator
              className="ml-auto"
              connectionState={connectionState}
              githubConnected={!repos.error}
              lastSyncAt={lastEventAt}
            />
          </>
        }
      >
        <Routes>
          <Route element={<Navigate replace to="/overview" />} path="/" />
          <Route
            element={<OverviewPage repoName={repoName} />}
            path="/overview"
          />
          <Route element={<EscalationsPage />} path="/escalations" />
          <Route element={<InvestigationsPage />} path="/investigations" />
          <Route
            element={<InvestigationDetailPage />}
            path="/investigations/:id"
          />
          <Route element={<GraphPage repoName={repoName} />} path="/graph" />
          <Route element={<HealthPage repoName={repoName} />} path="/health" />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
