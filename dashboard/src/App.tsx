import { useMemo, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom'

import { AgentActivityFeed } from '@/components/AgentActivityFeed'
import { AgentStatusIndicator } from '@/components/AgentStatusIndicator'
import { AppShell } from '@/components/AppShell'
import { EmptyState } from '@/components/EmptyState'
import {
  EscalationTable,
  type EscalationFilters,
  type EscalationRow,
} from '@/components/EscalationTable'
import { EscalationPreview } from '@/components/EscalationPreview'
import { HealthMetricBreakdown } from '@/components/HealthMetricBreakdown'
import { HealthScoreCard } from '@/components/HealthScoreCard'
import { HealthTrendChart } from '@/components/HealthTrendChart'
import { IssueGraph } from '@/components/IssueGraph'
import {
  RepositorySelector,
  type RepoSummary,
} from '@/components/RepositorySelector'
import {
  demoActivity,
  demoEscalations,
  demoHealthComponents,
  demoGraphLinks,
  demoGraphNodes,
  demoHealthTrend,
  demoRepos,
} from '@/demo/demoData'

/**
 * Shared app state.
 *
 * Deliberately plain React state rather than a store: five screens and one
 * selected repository do not justify a state library, and the API layer
 * (Stream A) will own the real fetching.
 *
 * Data comes from `demoData` until Stream A's endpoints exist. Every page
 * below is wired to props, so swapping fixtures for fetch calls touches only
 * this file.
 */
function useAppState() {
  const [selectedRepo, setSelectedRepo] = useState<RepoSummary>(demoRepos[0])
  const [isIndexing, setIsIndexing] = useState(false)
  const [escalations, setEscalations] =
    useState<EscalationRow[]>(demoEscalations)

  const overallHealth = useMemo(() => {
    const weighted = demoHealthComponents.reduce(
      (total, component) => total + component.score * component.weight,
      0,
    )
    return Math.round(weighted)
  }, [])

  const setStatus = (id: string, status: EscalationRow['status']) => {
    setEscalations((rows) =>
      rows.map((row) => (row.id === id ? { ...row, status } : row)),
    )
  }

  return {
    selectedRepo,
    setSelectedRepo,
    isIndexing,
    setIsIndexing,
    escalations,
    setStatus,
    overallHealth,
  }
}

type AppState = ReturnType<typeof useAppState>

function OverviewPage({ state }: { state: AppState }) {
  const critical = state.escalations.filter(
    (row) => row.severity === 'critical',
  ).length
  const pending = state.escalations.filter(
    (row) => row.status === 'pending',
  ).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <HealthScoreCard
          components={demoHealthComponents}
          overallScore={state.overallHealth}
          trend="up"
        />
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
              {pending}
            </p>
            <p className="text-xs text-text-muted">awaiting a maintainer</p>
          </div>
        </section>
        <AgentActivityFeed items={demoActivity} maxItems={6} />
      </div>

      <HealthTrendChart data={demoHealthTrend} />
    </div>
  )
}

function EscalationsPage({ state }: { state: AppState }) {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<EscalationFilters>({})
  const [selectedId, setSelectedId] = useState<string | undefined>(
    state.escalations[0]?.id,
  )
  const selected =
    state.escalations.find((row) => row.id === selectedId) ?? null

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <EscalationTable
        filters={filters}
        onFiltersChange={setFilters}
        onSelect={setSelectedId}
        rows={state.escalations}
        selectedId={selectedId}
      />
      <EscalationPreview
        escalation={selected}
        onApprove={async (id) => state.setStatus(id, 'approved')}
        onCorrect={async (id) => state.setStatus(id, 'corrected')}
        onOpenInvestigation={(id) => navigate(`/investigations/${id}`)}
        onReject={async (id) => state.setStatus(id, 'rejected')}
      />
    </div>
  )
}

function HealthPage({ state }: { state: AppState }) {
  return (
    <div className="flex flex-col gap-4">
      <HealthScoreCard
        components={demoHealthComponents}
        overallScore={state.overallHealth}
        trend="up"
      />
      <section
        aria-label="Health component breakdown"
        className="rounded-xl border border-border bg-surface-1 p-4"
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Component scores
        </h2>
        <HealthMetricBreakdown components={demoHealthComponents} />
      </section>
      <HealthTrendChart data={demoHealthTrend} />
    </div>
  )
}


function GraphPage() {
  const navigate = useNavigate()
  return (
    <IssueGraph
      links={demoGraphLinks}
      nodes={demoGraphNodes}
      onSelectIssue={(node) => navigate(`/investigations/issue-${node.number}`)}
    />
  )
}

/**
 * Investigation routes are Stream C's surface. Placeholders here keep the
 * navigation honest -- an empty state that says what is missing beats a dead
 * link or a fabricated screen.
 */
function InvestigationsPage() {
  return (
    <EmptyState
      description="The investigation list and trace are Stream C's components. They render here once wired to the API."
      title="Investigations"
    />
  )
}

export function App() {
  const state = useAppState()

  return (
    <BrowserRouter>
      <AppShell
        toolbar={
          <>
            <RepositorySelector
              isIndexing={state.isIndexing}
              onIndexRequested={async () => {
                state.setIsIndexing(true)
                // Placeholder until POST /api/repos/{owner}/{repo}/index exists.
                await new Promise((resolve) => setTimeout(resolve, 1200))
                state.setIsIndexing(false)
              }}
              onSelect={state.setSelectedRepo}
              repos={demoRepos}
              selectedRepo={state.selectedRepo}
            />
            <AgentStatusIndicator
              className="ml-auto"
              connectionState="offline"
              githubConnected
              lastSyncAt={state.selectedRepo.last_scan}
            />
          </>
        }
      >
        <Routes>
          <Route element={<Navigate replace to="/overview" />} path="/" />
          <Route element={<OverviewPage state={state} />} path="/overview" />
          <Route
            element={<EscalationsPage state={state} />}
            path="/escalations"
          />
          <Route element={<InvestigationsPage />} path="/investigations" />
          <Route element={<InvestigationsPage />} path="/investigations/:id" />
          <Route element={<GraphPage />} path="/graph" />
          <Route element={<HealthPage state={state} />} path="/health" />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
