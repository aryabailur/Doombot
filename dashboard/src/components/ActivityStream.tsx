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
    <div className="flex flex-col gap-3">
      {events.map((event, i) => {
        const { icon: Icon, color } = KIND_META[event.kind];
        const isLatest = i === 0;
        return (
          <div key={i} className="flex items-start gap-3 animate-rise-in">
            <div className="relative mt-0.5 flex-none">
              <Icon className={`h-4 w-4 ${color}`} strokeWidth={2.25} />
              {isLatest && live && (
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
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
