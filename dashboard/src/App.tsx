import { useEffect, useState } from "react";
import { TriangleAlert, Search } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { HealthScoreCard } from "./components/HealthScoreCard";
import { HealthTrendChart } from "./components/HealthTrendChart";
import { InvestigationList } from "./components/InvestigationList";
import { InvestigationTrace } from "./components/InvestigationTrace";
import { EscalationTable } from "./components/EscalationTable";
import { AgentActivityFeed } from "./components/AgentActivityFeed";
import { EmptyState } from "./components/EmptyState";
import { useSocket } from "./lib/useSocket";
import {
  getRepos,
  getRepoHealth,
  listInvestigations,
  getInvestigation,
  listEscalations,
} from "./lib/api";
import type {
  RepoSummary,
  HealthResponse,
  InvestigationSummary,
  InvestigationDetail,
  Escalation,
} from "./lib/types";

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";

type Tab = "investigations" | "escalations";

export function App() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [investigations, setInvestigations] = useState<InvestigationSummary[] | null>(null);
  const [escalations, setEscalations] = useState<Escalation[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvestigationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("investigations");
  const [listError, setListError] = useState<string | null>(null);

  const { connectionState } = useSocket({ url: WS_URL, onEvent: () => {} });

  function loadOverview() {
    getRepos()
      .then((r) => {
        setRepos(r);
        if (r[0]) {
          const [owner, repo] = r[0].repo_name.split("/");
          getRepoHealth(owner, repo).then(setHealth).catch(() => {});
        }
      })
      .catch(() => setRepos([]));
    listInvestigations()
      .then((inv) => {
        setInvestigations(inv);
        setListError(null);
        if (inv[0] && !selectedId) setSelectedId(inv[0].investigation_id);
      })
      .catch(() => setListError("Could not reach the API."));
    listEscalations()
      .then(setEscalations)
      .catch(() => setEscalations([]));
  }

  useEffect(() => {
    loadOverview();
    const interval = setInterval(loadOverview, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setDetail(null);
    setDetailError(null);
    getInvestigation(selectedId)
      .then(setDetail)
      .catch(() => setDetailError("Could not load this investigation."));
  }, [selectedId]);

  const activeRepo = repos?.[0];

  return (
    <AppShell connectionState={connectionState}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_320px]">
        {/* Left: health + queue tabs */}
        <div className="flex flex-col gap-4">
          <HealthScoreCard health={health} />
          {health && <HealthTrendChart history={health.history} />}

          <div className="flex gap-1 rounded-lg border-2 border-border bg-surface-1 p-1 shadow-brutal-sm">
            <button
              onClick={() => setTab("investigations")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                tab === "investigations" ? "bg-accent text-white" : "text-text-secondary"
              }`}
            >
              <Search className="h-3.5 w-3.5" strokeWidth={2.5} />
              Investigations
            </button>
            <button
              onClick={() => setTab("escalations")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                tab === "escalations" ? "bg-accent text-white" : "text-text-secondary"
              }`}
            >
              <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2.5} />
              Escalations
              {escalations && escalations.length > 0 && (
                <span className="ml-0.5 rounded-full border border-border bg-critical px-1.5 text-[10px] text-white">
                  {escalations.length}
                </span>
              )}
            </button>
          </div>

          {tab === "investigations" ? (
            <InvestigationList
              investigations={investigations}
              error={listError}
              onRetry={loadOverview}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <EscalationTable
              escalations={escalations}
              onSelect={setSelectedId}
            />
          )}
        </div>

        {/* Center: the hero trace */}
        <div>
          <div className="mb-4 rounded-xl border-2 border-border bg-surface-1 p-4 shadow-brutal">
            {detail ? (
              <>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-extrabold text-text-primary">
                    {detail.title}
                  </h2>
                  <span className="flex-none rounded-md border-2 border-border bg-surface-2 px-2 py-0.5 font-mono text-xs font-bold">
                    #{detail.number}
                  </span>
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {detail.repo_name} · {detail.kind} · {detail.status}
                </p>
              </>
            ) : detailError ? (
              <p className="text-sm text-critical">{detailError}</p>
            ) : (
              <p className="text-sm text-text-muted">Select an investigation to inspect its chain.</p>
            )}
          </div>

          {detail ? (
            <InvestigationTrace
              investigationId={detail.investigation_id}
              initialSteps={detail.steps}
              live={detail.status === "running"}
              decisionReason={detail.decision_reason}
              confidence={detail.confidence}
            />
          ) : !detailError ? (
            <EmptyState
              icon={Search}
              title="Nothing selected"
              description="Pick an investigation from the left to watch the agent's reasoning chain."
            />
          ) : null}
        </div>

        {/* Right: live activity */}
        <div className="flex flex-col gap-4">
          <AgentActivityFeed wsUrl={WS_URL} />
          {activeRepo && (
            <div className="rounded-xl border-2 border-border bg-surface-3 p-4 shadow-brutal">
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide">
                Repos Tracked
              </h3>
              <ul className="flex flex-col gap-1.5">
                {(repos ?? []).map((r) => (
                  <li key={r.repo_name} className="flex items-center justify-between text-xs">
                    <span className="truncate font-mono text-text-secondary">{r.repo_name}</span>
                    <span className="font-bold text-text-primary">{Math.round(r.health_score)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
