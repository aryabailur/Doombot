import { useState } from "react";
import { History } from "lucide-react";
import type { ActivityPayload, WsEnvelope } from "../lib/types";
import { formatRelativeTime } from "../lib/format";
import { useSocket } from "../lib/useSocket";
import { EmptyState } from "./EmptyState";

export interface AgentActivityFeedProps {
  wsUrl: string;
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-critical",
  high: "bg-high",
  warning: "bg-warning",
  info: "bg-information",
};

export function AgentActivityFeed({ wsUrl }: AgentActivityFeedProps) {
  const [events, setEvents] = useState<ActivityPayload[]>([]);

  useSocket({
    url: wsUrl,
    onEvent: (envelope: WsEnvelope) => {
      if (envelope.type !== "activity") return;
      const payload = envelope.data as ActivityPayload;
      setEvents((prev) => [payload, ...prev].slice(0, 30));
    },
  });

  return (
    <div className="rounded-xl border-2 border-border bg-surface-1 p-4 shadow-brutal">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-accent" strokeWidth={2.5} />
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">Live Activity</h3>
      </div>
      {events.length === 0 ? (
        <EmptyState title="Listening..." description="Activity will appear here in real time." />
      ) : (
        <ul className="flex flex-col gap-2 max-h-72 overflow-y-auto">
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-2 animate-slide-in text-sm">
              <span
                className={`mt-1.5 h-2 w-2 flex-none rounded-full border border-border ${SEVERITY_DOT[e.severity] ?? "bg-neutral"}`}
              />
              <div className="min-w-0">
                <p className="text-text-primary">{e.message}</p>
                <p className="text-xs text-text-muted">
                  {e.repo_name} · {formatRelativeTime(e.ts)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
