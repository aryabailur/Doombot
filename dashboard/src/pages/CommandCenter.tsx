import { useEffect, useState, useCallback, useMemo } from "react";
import { FileWarning, GitPullRequest, Clock, Copy, Plus } from "lucide-react";
import { AttentionCard } from "../components/AttentionCard";
import { AgentSummaryStrip } from "../components/AgentSummaryStrip";
import { MetricCard } from "../components/MetricCard";
import { HealthChart } from "../components/HealthChart";
import { ActivityStream, type ActivityEvent } from "../components/ActivityStream";
import { useRepo } from "../lib/RepoContext";
import { useSocket } from "../lib/useSocket";
import { getRepoHealth, createInvestigation } from "../lib/api";
import { loadInvestigationsWithDetail } from "../lib/adapters";
import type { Investigation } from "../lib/seed";
import type { HealthResponseApi, WsEnvelope } from "../lib/types";

type TypeFilter = "all" | "issue" | "pr";
type SortMode = "priority" | "newest";

const SEVERITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";

export function CommandCenter() {
  const { repoName, owner, repo } = useRepo();
  const [investigations, setInvestigations] = useState<Investigation[] | null>(null);
  const [health, setHealth] = useState<HealthResponseApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [issueNumber, setIssueNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("priority");

  const load = useCallback(() => {
    loadInvestigationsWithDetail(repoName)
      .then(setInvestigations)
      .catch(() => setError("Could not reach RepoGuardian's API. Is the backend running on :8000?"));
    if (owner && repo) {
      getRepoHealth(owner, repo)
        .then(setHealth)
        .catch(() => {});
    }
  }, [repoName, owner, repo]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  useSocket({
    url: WS_URL,
    onEvent: (envelope: WsEnvelope) => {
      if (envelope.type === "step.started" || envelope.type === "step.completed") {
        const data = envelope.data as { title: string; status: string };
        setIsWorking(data.status === "running");
        setEvents((prev) =>
          [
            {
              ts: new Date().toLocaleTimeString(),
              kind: data.status === "running" ? ("investigating" as const) : ("action" as const),
              title: data.title,
            },
            ...prev,
          ].slice(0, 20)
        );
      }
      if (envelope.type === "investigation.completed") {
        setIsWorking(false);
        load();
      }
    },
  });

  async function handleInvestigate(e: React.FormEvent) {
    e.preventDefault();
    const number = parseInt(issueNumber, 10);
    if (!number || !owner || !repo) return;
    setSubmitting(true);
    try {
      await createInvestigation({ repo_name: repoName, kind: "issue", number });
      setIssueNumber("");
      setTimeout(load, 500);
    } catch {
      setError(`Could not start an investigation for #${number}.`);
    } finally {
      setSubmitting(false);
    }
  }

  const attention = (investigations ?? []).filter((i) => i.needsAttention);
  const total = investigations?.length ?? 0;
  const handled = total - attention.length;

  // Most recent real investigation timestamp across the repo — used as the
  // strip's "Last scan" value. No fabricated relative-time fallback: if
  // there's no investigation yet, the field is simply omitted.
  const lastScanAt = useMemo(() => {
    if (!investigations || investigations.length === 0) return null;
    return investigations.reduce<string | null>((latest, inv) => {
      if (!latest) return inv.createdAt;
      return new Date(inv.createdAt) > new Date(latest) ? inv.createdAt : latest;
    }, null);
  }, [investigations]);

  const visibleAttention = useMemo(() => {
    // Re-investigating an issue leaves multiple completed investigation
    // records for the same number (real history, not a bug) — collapse to
    // the most recent per issue/PR so the same card never appears twice.
    const latestByNumber = new Map<string, Investigation>();
    for (const inv of attention) {
      const key = `${inv.kind}:${inv.number}`;
      const existing = latestByNumber.get(key);
      if (!existing || new Date(inv.createdAt) > new Date(existing.createdAt)) {
        latestByNumber.set(key, inv);
      }
    }
    const deduped = Array.from(latestByNumber.values());
    const filtered = typeFilter === "all" ? deduped : deduped.filter((i) => i.kind === typeFilter);
    const sorted = [...filtered];
    if (sortMode === "priority") {
      sorted.sort((a, b) => {
        const rankDiff = (SEVERITY_RANK[b.severity ?? "low"] ?? 0) - (SEVERITY_RANK[a.severity ?? "low"] ?? 0);
        if (rankDiff !== 0) return rankDiff;
        return b.confidence - a.confidence;
      });
    } else {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [attention, typeFilter, sortMode]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-semibold text-muted">Connected repository</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink">{repoName}</h1>
        <p className="text-lg text-ink/70">
          {investigations === null
            ? "Loading…"
            : total === 0
              ? "No investigations run yet — this repo hasn't been checked."
              : `${attention.length} things deserve your attention.`}
        </p>
      </div>

      {investigations !== null && total > 0 && (
        <AgentSummaryStrip
          investigatedCount={total}
          handledCount={handled}
          surfacedCount={attention.length}
          lastScanAt={lastScanAt}
          isWorking={isWorking}
        />
      )}

      <form onSubmit={handleInvestigate} className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 shadow-flat-sm">
        <span className="text-sm font-semibold text-muted">Investigate issue</span>
        <span className="font-mono text-sm text-muted">#</span>
        <input
          value={issueNumber}
          onChange={(e) => setIssueNumber(e.target.value)}
          placeholder="42"
          className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-sm outline-none"
        />
        <button
          type="submit"
          disabled={submitting || !issueNumber}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          {submitting ? "Starting…" : "Run Investigation"}
        </button>
      </form>

      {error && (
        <div className="rounded-xl border border-border bg-danger-soft px-4 py-3 text-sm text-ink">{error}</div>
      )}

      {investigations !== null && total === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-card p-8 shadow-flat-sm">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-20 blur-3xl"
            style={{ background: "radial-gradient(circle, var(--info), transparent 70%)" }}
          />
          <div className="relative z-10 flex flex-col items-start gap-3">
            <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-info">
              Not yet investigated
            </span>
            <p className="text-lg font-bold text-ink">
              RepoGuardian hasn't looked at <span className="font-mono">{repoName}</span> yet.
            </p>
            <p className="max-w-xl text-sm text-ink/70">
              Nothing below is real data until you run at least one investigation. Enter an issue
              number above and click <strong>Run Investigation</strong> — or click{" "}
              <strong>Index Repository</strong> in the sidebar first if you want duplicate
              detection and Project Memory search primed with real history.
            </p>
          </div>
        </div>
      ) : null}

      {investigations === null ? (
        <p className="text-sm text-muted">Loading investigations…</p>
      ) : total === 0 ? null : attention.length === 0 ? (
        <p className="text-sm text-muted">Nothing needs attention right now.</p>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Requires Your Attention</h2>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-ink">
                <span className="text-muted">Type</span>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                  className="bg-transparent outline-none"
                >
                  <option value="all">All types</option>
                  <option value="issue">Issues</option>
                  <option value="pr">Pull requests</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-ink">
                <span className="text-muted">Sort</span>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="bg-transparent outline-none"
                >
                  <option value="priority">Priority</option>
                  <option value="newest">Newest</option>
                </select>
              </label>
            </div>
          </div>
          {visibleAttention.length === 0 ? (
            <p className="text-sm text-muted">No attention items match this filter.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {visibleAttention.map((inv, i) => (
                <AttentionCard key={inv.id} investigation={inv} style={{ "--stagger-i": i } as React.CSSProperties} />
              ))}
            </div>
          )}
        </div>
      )}

      {health && total > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Health Score"
              value={String(Math.round(health.score))}
              icon={FileWarning}
              style={{ "--stagger-i": 0 } as React.CSSProperties}
            />
            <MetricCard
              label="Security"
              value={String(Math.round(health.breakdown.security))}
              icon={GitPullRequest}
              style={{ "--stagger-i": 1 } as React.CSSProperties}
            />
            <MetricCard
              label="Responsiveness"
              value={String(Math.round(health.breakdown.responsiveness))}
              icon={Clock}
              style={{ "--stagger-i": 2 } as React.CSSProperties}
            />
            <MetricCard
              label="Duplication"
              value={String(Math.round(health.breakdown.duplication))}
              icon={Copy}
              style={{ "--stagger-i": 3 } as React.CSSProperties}
            />
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-flat-sm">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Health History</h3>
            <HealthChart data={health.history.map((h) => ({ ts: h.ts, value: h.score }))} color="var(--accent)" />
          </div>
        </>
      )}

      <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted">Live Agent Activity</h3>
        {events.length === 0 ? (
          <p className="text-sm text-muted">Listening for agent activity… run an investigation above to see it stream in.</p>
        ) : (
          <ActivityStream events={events} />
        )}
      </div>
    </div>
  );
}
