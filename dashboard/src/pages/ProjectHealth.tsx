import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import { getRepoHealth, listInvestigations } from "../lib/api";
import type { HealthResponseApi, HealthTrend } from "../lib/types";
import { HealthChart } from "../components/HealthChart";
import { InsightCard } from "../components/InsightCard";

const TREND_META: Record<HealthTrend, { icon: typeof TrendingUp; color: string; label: string }> = {
  improving: { icon: TrendingUp, color: "var(--success)", label: "Improving" },
  stable: { icon: Minus, color: "var(--warning)", label: "Stable" },
  declining: { icon: TrendingDown, color: "var(--danger)", label: "Declining" },
};

export function ProjectHealth() {
  const { owner, repo, repoName } = useRepo();
  const [health, setHealth] = useState<HealthResponseApi | null>(null);
  const [investigationCount, setInvestigationCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo) return;
    setHealth(null);
    setInvestigationCount(null);
    getRepoHealth(owner, repo)
      .then(setHealth)
      .catch(() => setError("Could not load health for this repository."));
    listInvestigations(repoName)
      .then((rows) => setInvestigationCount(rows.length))
      .catch(() => setInvestigationCount(0));
  }, [owner, repo, repoName]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!health || investigationCount === null) return <p className="text-sm text-muted">Loading project health…</p>;

  if (investigationCount === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Project Health</h1>
          <p className="text-sm text-muted">{repoName}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-card p-8 shadow-flat-sm">
          <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-info">
            Not yet investigated
          </span>
          <p className="mt-3 text-lg font-bold text-ink">No health data yet for {repoName}.</p>
          <p className="mt-2 max-w-xl text-sm text-ink/70">
            Health scores, breakdowns, and forecasts are derived from real investigations. Run at
            least one from Command Center before this page reflects anything meaningful — right
            now every number here would just be a neutral placeholder, not a real assessment.
          </p>
        </div>
      </div>
    );
  }

  const metrics = [
    { label: "Security", value: health.breakdown.security, color: "var(--success)" },
    { label: "Staleness", value: health.breakdown.staleness, color: "var(--warning)" },
    { label: "Duplication", value: health.breakdown.duplication, color: "var(--info)" },
    { label: "Responsiveness", value: health.breakdown.responsiveness, color: "var(--accent)" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-flat">
        <p className="text-xs font-bold uppercase tracking-widest text-muted">Project Health · {repoName}</p>
        <p className="mt-2 font-mono text-6xl font-extrabold text-ink">
          {Math.round(health.score)}
          <span className="text-2xl text-muted"> / 100</span>
        </p>
        <p className="mt-2 text-lg font-semibold text-ink/80">
          {health.score >= 80 ? "Healthy" : health.score >= 50 ? "Healthy with signals" : "Needs attention"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-2xl border border-border bg-card p-5 shadow-flat-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">{m.label}</span>
              <span className="font-mono text-xs font-bold text-ink">{Math.round(m.value)}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full" style={{ width: `${m.value}%`, backgroundColor: m.color }} />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-flat-sm">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Score History</h3>
        <HealthChart data={health.history.map((h) => ({ ts: h.ts, value: h.score }))} />
      </div>

      {health.forecast ? (
        <div className="animate-rise-in rounded-2xl border border-border bg-card p-5 shadow-flat-sm">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
            Forecast · Next {health.forecast.horizon_days} Days
          </h3>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <p className="font-mono text-3xl font-extrabold text-ink">
              {Math.round(health.score)}
              <span className="mx-2 text-xl text-muted">&rarr;</span>
              {Math.round(health.forecast.projected_score)}
              <span className="text-sm font-semibold text-muted"> in {health.forecast.horizon_days}d</span>
            </p>
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide"
              style={{ color: TREND_META[health.forecast.trend].color, backgroundColor: "var(--background)" }}
            >
              {(() => {
                const TrendIcon = TREND_META[health.forecast.trend].icon;
                return <TrendIcon className="h-3.5 w-3.5" strokeWidth={2.5} />;
              })()}
              {TREND_META[health.forecast.trend].label}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {health.forecast.projected_backlog !== null && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Projected Open Investigations</p>
                <p className="font-mono text-lg font-bold text-ink">
                  {Math.round(health.forecast.projected_backlog)}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Confidence</p>
              <p className="font-mono text-lg font-bold text-ink">{Math.round(health.forecast.confidence * 100)}%</p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-ink/80">{health.forecast.reason}</p>
        </div>
      ) : (
        <div className="animate-rise-in rounded-2xl border border-border bg-card p-5 shadow-flat-sm">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Forecast</h3>
          <p className="text-sm text-muted">
            Forecast needs at least 2 recorded health snapshots — check back after more investigations run.
          </p>
        </div>
      )}

      <InsightCard
        copy={
          health.history.length > 1
            ? `Health score has moved from ${Math.round(health.history[0].score)} to ${Math.round(health.score)} across ${health.history.length} recorded snapshots.`
            : "This is the first recorded health snapshot for this repository — trend data will build up as more investigations run."
        }
      />
    </div>
  );
}
