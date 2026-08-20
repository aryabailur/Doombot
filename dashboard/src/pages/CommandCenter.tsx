import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileWarning, GitPullRequest, Clock, Copy, Plus, Sparkles } from "lucide-react";
import { AttentionCard } from "../components/AttentionCard";
import { MetricCard } from "../components/MetricCard";
import { HealthChart } from "../components/HealthChart";
import { ActivityStream, type ActivityEvent } from "../components/ActivityStream";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { useRepo } from "../lib/RepoContext";
import { useSocket } from "../lib/useSocket";
import { listEscalations, getRepoHealth, createInvestigation } from "../lib/api";
import { loadInvestigationsWithDetail } from "../lib/adapters";
import type { Investigation } from "../lib/seed";
import type { HealthResponseApi, WsEnvelope } from "../lib/types";

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";

export function CommandCenter() {
  const navigate = useNavigate();
  const { repoName, owner, repo } = useRepo();
  const [investigations, setInvestigations] = useState<Investigation[] | null>(null);
  const [escalationCount, setEscalationCount] = useState(0);
  const [health, setHealth] = useState<HealthResponseApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [issueNumber, setIssueNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  const load = useCallback(() => {
    loadInvestigationsWithDetail(repoName)
      .then(setInvestigations)
      .catch(() => setError("Could not reach RepoGuardian's API. Is the backend running on :8000?"));
    listEscalations(repoName)
      .then((rows) => setEscalationCount(rows.length))
      .catch(() => {});
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
      ) : (
        <div
          className={`relative grid grid-cols-1 gap-4 overflow-hidden rounded-2xl border border-border bg-ink p-8 text-white shadow-flat lg:grid-cols-[1fr_auto] ${
            isWorking ? "animate-live-border" : ""
          }`}
        >
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl transition-opacity duration-700"
            style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }}
          />
          <div className="relative z-10">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-accent">
              {isWorking && <Sparkles className="h-3.5 w-3.5 animate-pulse-dot" strokeWidth={2.5} />}
              {attention.length} things need you
            </p>
            <p className="mt-2 font-mono text-5xl font-extrabold leading-none">
              <AnimatedNumber value={handled} />
              <span className="ml-3 text-lg font-semibold text-white/60">handled automatically</span>
            </p>
            <p className="mt-4 max-w-xl text-sm text-white/70">
              The agent has run {total} investigation{total === 1 ? "" : "s"} on {repoName} and surfaced {attention.length} for review.
            </p>
          </div>
          <button
            onClick={() => navigate("/attention")}
            className="relative z-10 flex h-fit items-center gap-2 self-center overflow-hidden rounded-lg bg-accent px-5 py-3 text-sm font-bold uppercase tracking-wide text-white transition-all duration-300 hover:-translate-y-0.5 hover:gap-3 hover:shadow-flat-sm"
          >
            Review Attention ({escalationCount})
            <ArrowRight className="h-4 w-4 transition-transform duration-300" strokeWidth={2.5} />
          </button>
        </div>
      )}

      {investigations === null ? (
        <p className="text-sm text-muted">Loading investigations…</p>
      ) : total === 0 ? null : attention.length === 0 ? (
        <p className="text-sm text-muted">Nothing needs attention right now.</p>
      ) : (
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">Requires Your Attention</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {attention.map((inv, i) => (
              <AttentionCard key={inv.id} investigation={inv} style={{ "--stagger-i": i } as React.CSSProperties} />
            ))}
          </div>
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
