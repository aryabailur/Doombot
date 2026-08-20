import { useEffect, useState } from "react";
import { ActivityStream, type ActivityEvent } from "../components/ActivityStream";
import { useSocket } from "../lib/useSocket";
import { getActivity, ApiError } from "../lib/api";
import type { WsEnvelope, ActivityEventApi } from "../lib/types";
import { useRepo } from "../lib/RepoContext";

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";

const FILTERS = ["All", "Investigations", "Escalations", "Actions"] as const;
type Filter = (typeof FILTERS)[number];

function mapActivityEvent(event: ActivityEventApi): ActivityEvent {
  const message = event.message.toLowerCase();
  let kind: ActivityEvent["kind"];

  if (event.severity === "error") {
    kind = "escalated";
  } else if (event.kind === "decider") {
    kind = message.includes("escalate") ? "escalated" : "silent";
  } else if (message.includes("posted") || message.includes("labeled") || message.includes("comment")) {
    kind = "action";
  } else {
    kind = "investigating";
  }

  return {
    ts: new Date(event.ts).toLocaleTimeString(),
    kind,
    title: event.message,
    detail: event.number ? `#${event.number} · ${event.repo_name}` : event.repo_name,
  };
}

export function AgentActivity() {
  const { repoName } = useRepo();
  const [filter, setFilter] = useState<Filter>("All");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getActivity(repoName, 50)
      .then((page) => {
        if (cancelled) return;
        setEvents(page.events.map(mapActivityEvent));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? `status ${err.status}` : "network error";
        setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [repoName]);

  const { connectionState } = useSocket({
    url: WS_URL,
    onEvent: (envelope: WsEnvelope) => {
      if (envelope.type === "step.started" || envelope.type === "step.completed") {
        const data = envelope.data as { title: string; status: string; name: string; output_summary?: string };
        setEvents((prev) =>
          [
            {
              ts: new Date().toLocaleTimeString(),
              kind: data.status === "running" ? ("investigating" as const) : ("action" as const),
              title: data.title,
              detail: data.output_summary,
            },
            ...prev,
          ].slice(0, 100)
        );
      } else if (envelope.type === "investigation.completed") {
        const data = envelope.data as { decision: string };
        setEvents((prev) =>
          [
            {
              ts: new Date().toLocaleTimeString(),
              kind: data.decision === "escalate" ? ("escalated" as const) : ("silent" as const),
              title: `Investigation completed — decision: ${data.decision}`,
            },
            ...prev,
          ].slice(0, 100)
        );
      }
    },
  });

  const filtered = events.filter((e) => {
    if (filter === "All") return true;
    if (filter === "Investigations") return e.kind === "investigating";
    if (filter === "Escalations") return e.kind === "escalated";
    if (filter === "Actions") return e.kind === "action";
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Agent Activity</h1>
        <p className="text-sm text-muted">
          Live stream for {repoName}. Connection: <span className="font-mono">{connectionState}</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
              filter === f ? "border-ink bg-ink text-white" : "border-border bg-card text-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">
            Recent activity for {repoName} · {events.length} event{events.length === 1 ? "" : "s"}
          </p>
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connectionState === "connected" ? "animate-pulse-dot bg-accent" : "bg-muted"
              }`}
            />
            {connectionState === "connected" ? "Live" : connectionState}
          </span>
        </div>
        {loadError && (
          <p className="mb-4 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted">
            Couldn't load activity history ({loadError}). Showing live events only.
          </p>
        )}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted">
            No activity yet — trigger an investigation from Command Center to see agent steps here.
          </p>
        ) : (
          <ActivityStream events={filtered} />
        )}
      </div>
    </div>
  );
}
