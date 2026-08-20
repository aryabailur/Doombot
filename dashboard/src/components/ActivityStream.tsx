import { Search, ShieldCheck, TriangleAlert, MessageSquare } from "lucide-react";

export interface ActivityEvent {
  ts: string;
  kind: "investigating" | "silent" | "escalated" | "action";
  title: string;
  detail?: string;
}

export interface ActivityStreamProps {
  events: ActivityEvent[];
  live?: boolean;
}

const KIND_META: Record<ActivityEvent["kind"], { icon: typeof Search; color: string }> = {
  investigating: { icon: Search, color: "text-info" },
  silent: { icon: ShieldCheck, color: "text-success" },
  escalated: { icon: TriangleAlert, color: "text-danger" },
  action: { icon: MessageSquare, color: "text-warning" },
};

export function ActivityStream({ events, live = true }: ActivityStreamProps) {
  return (
    <div className="flex flex-col">
      {events.map((event, i) => {
        const { icon: Icon, color } = KIND_META[event.kind];
        const isLatest = i === 0;
        const isLast = i === events.length - 1;
        return (
          <div
            key={i}
            className="animate-stagger-in relative flex items-start gap-3 pb-4 last:pb-0"
            style={{ "--stagger-i": Math.min(i, 10) } as React.CSSProperties}
          >
            {!isLast && <div className="absolute top-5 left-2 h-full w-px bg-border" />}
            <div className="relative z-10 mt-0.5 flex h-4 w-4 flex-none items-center justify-center">
              <Icon className={`h-4 w-4 ${color} transition-transform duration-200 ${isLatest && live ? "scale-110" : ""}`} strokeWidth={2.25} />
              {isLatest && live && (
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="absolute inset-0 animate-agent-pulse-ring rounded-full bg-accent" />
                  <span className="relative h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-muted">{event.ts}</span>
                <span className="text-sm font-semibold text-ink">{event.title}</span>
              </div>
              {event.detail && <p className="mt-0.5 text-xs text-muted">{event.detail}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
