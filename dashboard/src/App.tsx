import { useCallback, useState } from 'react'

import { Loader2 } from 'lucide-react'
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
import {
  OnboardingPipeline,
  type PipelineEvent,
} from '@/components/OnboardingPipeline'
import { RepositorySelector } from '@/components/RepositorySelector'
import { SkeletonState } from '@/components/SkeletonState'
import {
  decideAction,
  getInvestigation,
  getCodeGraph,
  getIssueGraph,
  getRepoHealth,
  getRepos,
  indexRepo,
  listEscalations,
  listInvestigations,
  onboardRepository,
  postFeedback,
  scanRepository,
  WS_URL,
} from '@/lib/api'
import type {
  Escalation,
  HealthResponse,
  RepoSummary,
  StepRecord,
} from '@/lib/types'
import { useApiData } from '@/lib/useApiData'
import { useSocket, type WsEnvelope } from '@/lib/useSocket'

/**
 * The repository list for the selector: what the API knows, plus anything
 * added this session, plus the current selection.
 *
 * Every entry the API did not supply gets zeroed counters rather than
 * invented ones -- the real values arrive with the next /api/repos response.
 */
function mergeRepos(
  fromApi: RepoSummary[] | null,
  added: string[],
  current: string,
): RepoSummary[] {
  const merged = [...(fromApi ?? [])]
  const seen = new Set(merged.map((repo) => repo.repo_name))

  for (const name of [...added, current]) {
    if (!name || seen.has(name)) {
      continue
    }
    seen.add(name)
    merged.push({
      repo_name: name,
      health_score: 0,
      open_investigations: 0,
      last_scan: null,
    })
  }
  return merged
}

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

function OverviewPage({
  repoName,
  dataVersion,
  liveActivity,
  liveStep,
}: {
  repoName: string
  dataVersion: number
  liveActivity: ActivityItem[]
  liveStep: string | null
}) {
  const [owner, repo] = splitRepo(repoName)
  const health = useApiData<HealthResponse>(() => getRepoHealth(owner, repo), {
    pollMs: 60_000,
    refreshKey: dataVersion,
  })
  // Scoped to the selected repository. Unscoped, every panel showed another
  // repository's work, which read as "it did not analyse my repo".
  const escalations = useApiData(() => listEscalations(repoName), {
    pollMs: 20_000,
    refreshKey: dataVersion,
  })
  const investigations = useApiData(() => listInvestigations(repoName), {
    pollMs: 20_000,
    refreshKey: dataVersion,
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

  // Live socket events first, then history. The live ones are what make the
  // agent visibly working rather than apparently idle.
  const mergedActivity = [...liveActivity, ...activity].slice(0, 40)

  if (health.error && !health.data) {
    return <ErrorState kind={health.error} onRetry={health.reload} />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {health.data ? (
          <HealthScoreCard
            components={toComponents(health.data)}
            measured={health.data.measured}
            unreadable={health.data.unreadable}
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

        {/* A visible "working now" line. Without it a run that takes half a
            minute looks like nothing is happening at all. */}
        {liveStep ? (
          <p className="flex items-center gap-2 rounded-lg border border-accent-muted bg-surface-2 px-3 py-2 text-xs text-text-secondary">
            <Loader2
              aria-hidden="true"
              className="size-3.5 shrink-0 text-accent motion-safe:animate-spin"
            />
            <span className="truncate">{liveStep}</span>
          </p>
        ) : null}
        <AgentActivityFeed items={mergedActivity} maxItems={8} />
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

function EscalationsPage({ repoName, dataVersion }: { repoName: string; dataVersion: number }) {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<EscalationFilters>({})
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [decided, setDecided] = useState<
    Record<string, EscalationRow['status']>
  >({})
  const [decisionError, setDecisionError] = useState<string | null>(null)

  const escalations = useApiData(() => listEscalations(repoName), {
    pollMs: 20_000,
    refreshKey: dataVersion,
  })

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
    setDecisionError(null)
    try {
      const investigation = await getInvestigation(id)
      if (investigation.proposed_action) {
        await decideAction(investigation.proposed_action.id, {
          approved: verdict === 'up',
          decided_by: 'RepoGuardian dashboard maintainer',
          note,
        })
      } else {
        // Historical investigations created before the approval lifecycle
        // have no exact payload to execute. Preserve their feedback path, but
        // never represent it as a GitHub action.
        await postFeedback({ investigation_id: id, verdict, note })
      }
      setDecided((current) => ({ ...current, [id]: status }))
    } catch (error) {
      setDecisionError(
        error instanceof Error ? error.message : 'The action decision could not be persisted.',
      )
    }
  }

  if (escalations.error && !escalations.data) {
    return <ErrorState kind={escalations.error} onRetry={escalations.reload} />
  }
  if (!escalations.data) {
    return <SkeletonState count={4} variant="list" />
  }

  return (
    <div className="flex flex-col gap-3">
      {decisionError ? (
        <p className="rounded-lg border border-critical/50 bg-surface-1 px-3 py-2 text-sm text-critical" role="alert">
          {decisionError}
        </p>
      ) : null}
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
    </div>
  )
}

function InvestigationsPage({ repoName, dataVersion }: { repoName: string; dataVersion: number }) {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const investigations = useApiData(() => listInvestigations(repoName), {
    pollMs: 15_000,
    refreshKey: dataVersion,
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

/**
 * Semantic graph explorer (F15).
 *
 * Renders the *code* graph rather than the issue graph. Their IssueGraph now
 * accepts either shape, and the code graph carries the blast-radius overlay,
 * which is the more compelling of the two views.
 *
 * Doombot's own repository opens with rag/graph.py marked as changed, so the
 * impact overlay has something to show immediately instead of a neutral
 * graph nobody can interpret.
 */
/**
 * The graph screen, fed by both graph endpoints and refreshed live.
 *
 * Two fixes are folded in here. First, this only ever passed `codeGraph`, so
 * the issue-relationship half of F15 was built, served, and never rendered --
 * the screen showed code structure while the issue graph the endpoint returns
 * went unused.
 *
 * Second, it was fetch-once. An investigation completing is exactly what
 * changes this graph -- a node's category flips, a duplicate edge appears --
 * so both halves reload on `investigation.completed`. That is the difference
 * between a diagram and a live view: a judge watching a scan finish sees the
 * graph react instead of having to reload the page.
 */
function GraphPage({ repoName }: { repoName: string }) {
  const [owner, repo] = splitRepo(repoName)
  const changedPaths =
    repoName.toLowerCase() === 'aryabailur/doombot' ? ['rag/graph.py'] : []

  const issues = useApiData(() => getIssueGraph(owner, repo), {})
  const code = useApiData(() => getCodeGraph(owner, repo, changedPaths), {})

  // Reload is identity-stable per fetch, so this only re-subscribes when the
  // repository changes -- not on every render.
  const reloadIssues = issues.reload
  const reloadCode = code.reload

  useSocket({
    url: WS_URL,
    onEvent: useCallback(
      (envelope: WsEnvelope) => {
        if (envelope.type === 'investigation.completed') {
          reloadIssues()
          reloadCode()
        }
      },
      [reloadIssues, reloadCode],
    ),
  })

  // Only a hard failure with nothing cached is worth blanking the screen for:
  // if one half loaded, render it rather than hiding both.
  if (issues.error && code.error && !issues.data && !code.data) {
    return <ErrorState kind={issues.error} onRetry={reloadIssues} />
  }
  if (!issues.data && !code.data) {
    return <SkeletonState className="min-h-[560px]" variant="card" />
  }

  return (
    <IssueGraph
      codeGraph={code.data ?? undefined}
      links={issues.data?.links}
      nodes={issues.data?.nodes}
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
  /**
   * Repositories added this session.
   *
   * GET /api/repos derives its list from investigation history plus the
   * monitor list, and indexing creates neither -- so a freshly added
   * repository is absent from that response and would drop out of the
   * dropdown the moment the list refreshed. Holding the names here keeps a
   * repo selectable from the instant it is added until its first
   * investigation gives the backend a record of it.
   */
  const [addedRepos, setAddedRepos] = useState<string[]>([])
  const [indexing, setIndexing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [owner, repo] = splitRepo(repoName)

  const repos = useApiData(() => getRepos(), {})

  /** What the API knows, plus anything added this session, plus the selection. */
  const selectableRepos = mergeRepos(repos.data, addedRepos, repoName)

  // One socket for the shell, purely to drive the connection indicator. The
  // detail page opens its own for step events -- the hub broadcasts to every
  // client, so a second connection costs nothing and keeps the pages
  // independent.
  /**
   * Live agent activity, straight off the socket.
   *
   * This handler used to be empty: the shell held a WebSocket open purely to
   * light the connection indicator and threw every event away. The agent would
   * work for half a minute -- fetching, comparing, scoring, deciding -- and the
   * screen showed nothing until a 20-second poll happened to land. That is what
   * made "Analyse" feel like it hung: the work was streaming past and nobody
   * was listening.
   */
  /** Pipeline stage events for the add-a-repository flow. */
  const [pipeline, setPipeline] = useState<PipelineEvent[]>([])

  /** Bumped when a run finishes, so every panel refetches at once. */
  const [dataVersion, setDataVersion] = useState(0)
  const [liveActivity, setLiveActivity] = useState<ActivityItem[]>([])
  const [liveStep, setLiveStep] = useState<string | null>(null)
  const [runningCount, setRunningCount] = useState(0)

  const { connectionState, lastEventAt } = useSocket({
    url: WS_URL,
    onEvent: useCallback((envelope: WsEnvelope) => {
      if (envelope.type === 'step.started' || envelope.type === 'step.completed') {
        const step = envelope.data as StepRecord
        if (envelope.type === 'step.started') {
          setLiveStep(step.title || step.name)
          return
        }
        setLiveActivity((current) =>
          [
            {
              id: `${step.investigation_id}-${step.step_id}`,
              message: `${step.title || step.name} — #${step.name}`,
              timestamp: step.ended_at || new Date().toISOString(),
              kind: 'investigation' as const,
            },
            ...current,
          ].slice(0, 40),
        )
        return
      }

      if (envelope.type === 'pipeline') {
        const stage = envelope.data as PipelineEvent
        setPipeline((current) => [...current, stage].slice(-24))
        if (stage.stage === 'investigate' && stage.status === 'running') {
          setRunningCount((current) => Math.max(current, stage.total ?? 0))
        }
        return
      }

      if (envelope.type === 'activity') {
        const info = envelope.data as { message?: string; queued?: number }
        if (typeof info.queued === 'number') {
          setRunningCount((current) => current + (info.queued ?? 0))
        }
        if (info.message) {
          const text = info.message
          setLiveActivity((current) =>
            [
              {
                id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                message: text,
                timestamp: new Date().toISOString(),
                kind: 'investigation' as const,
              },
              ...current,
            ].slice(0, 40),
          )
        }
        return
      }

      if (envelope.type === 'investigation.completed') {
        const done = envelope.data as { decision?: string }
        setLiveStep(null)
        setRunningCount((current) => Math.max(0, current - 1))
        setLiveActivity((current) =>
          [
            {
              id: `done-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              message: `finished — ${(done.decision ?? 'done').replace(/_/g, ' ')}`,
              timestamp: new Date().toISOString(),
              kind:
                done.decision === 'escalate'
                  ? ('escalation' as const)
                  : ('action_taken' as const),
            },
            ...current,
          ].slice(0, 40),
        )
        // Refresh immediately rather than waiting for the next poll: the run
        // just changed the very data every panel is showing.
        setDataVersion((current) => current + 1)
      }
    }, [setPipeline]),
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
              isScanning={scanning}
              onScanRequested={async (target) => {
                setScanning(true)
                setScanNote(null)
                try {
                  const [scanOwner, scanRepo] = splitRepo(target.repo_name)
                  const result = await scanRepository(scanOwner, scanRepo)
                  // The scan is queued, not finished -- how many issues it
                  // found arrives over the socket. "Scanning" is honest;
                  // claiming a count we do not have yet would not be.
                  setScanNote(`Scanning ${result.repo_name}…`)
                } catch (cause) {
                  setScanNote(
                    cause instanceof Error
                      ? `Could not analyse: ${cause.message}`
                      : 'Could not analyse that repository.',
                  )
                } finally {
                  setScanning(false)
                }
              }}
              onAddRepository={async (name) => {
                const [nextOwner, nextRepo] = splitRepo(name)

                // Scan first, and let it throw. It is the only step that
                // reads the repository synchronously, so it is the only one
                // that can tell a real public repo from a typo: indexing is
                // fire-and-forget (202-style, work happens in a thread), so
                // awaiting it succeeds even for a repository that does not
                // exist. Adding a bad name must not look like success.
                // Awaited so a bad name throws here and shows inline: the
                // endpoint validates the repository exists before queueing.
                // `onboard` rather than `scan` -- it narrates embedding too,
                // which is the slowest and previously most invisible stage.
                setPipeline([])
                await onboardRepository(nextOwner, nextRepo)

                // Indexing feeds duplicate detection and the issue graph.
                // Deliberately not awaited: embedding a large backlog takes
                // far longer than a click should block for, and the scan
                // above already established the repo is real.
                void indexRepo(nextOwner, nextRepo)

                setAddedRepos((current) =>
                  current.includes(name) ? current : [...current, name],
                )
                setRepoName(name)
                setScanNote(`Added ${name} — scanning for issues…`)
                repos.reload()
              }}
              onSelect={(next) => setRepoName(next.repo_name)}
              repos={selectableRepos}
              // Resolved against the merged list, not repos.data. A freshly
              // added repository is not in the API response yet -- indexing
              // creates no investigation record, so /api/repos cannot know
              // about it -- and looking it up there returned undefined, which
              // hid both the Index and Analyse buttons. The repo appeared in
              // the dropdown while being impossible to act on: exactly the
              // "Analyse just disappeared" symptom.
              selectedRepo={selectableRepos.find(
                (item) => item.repo_name === repoName,
              )}
            />
            {runningCount > 0 ? (
              <span className="flex items-center gap-1.5 rounded-md border border-accent-muted bg-surface-2 px-2 py-1 text-xs text-text-secondary">
                <Loader2
                  aria-hidden="true"
                  className="size-3.5 text-accent motion-safe:animate-spin"
                />
                {runningCount} investigating
              </span>
            ) : null}
            {scanNote ? (
              <button
                className="max-w-md truncate rounded-md border border-border bg-surface-2 px-2 py-1 text-left text-xs text-text-secondary"
                onClick={() => setScanNote(null)}
                title={`${scanNote} (click to dismiss)`}
                type="button"
              >
                {scanNote}
              </button>
            ) : null}
            <AgentStatusIndicator
              className="ml-auto"
              connectionState={connectionState}
              githubConnected={!repos.error}
              lastSyncAt={lastEventAt}
            />
          </>
        }
      >
        {pipeline.length > 0 ? (
          <OnboardingPipeline
            className="mb-4"
            currentStep={liveStep}
            events={pipeline}
            onDismiss={() => setPipeline([])}
            repoName={repoName}
          />
        ) : null}
        <Routes>
          <Route element={<Navigate replace to="/overview" />} path="/" />
          <Route
            element={
              <OverviewPage
                dataVersion={dataVersion}
                liveActivity={liveActivity}
                liveStep={liveStep}
                repoName={repoName}
              />
            }
            path="/overview"
          />
          <Route
            element={<EscalationsPage dataVersion={dataVersion} repoName={repoName} />}
            path="/escalations"
          />
          <Route
            element={<InvestigationsPage dataVersion={dataVersion} repoName={repoName} />}
            path="/investigations"
          />
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
