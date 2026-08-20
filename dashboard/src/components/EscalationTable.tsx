import { TriangleAlert } from "lucide-react";
import type { Escalation } from "../lib/types";
import { formatRelativeTime } from "../lib/format";
import { SeverityBadge } from "./SeverityBadge";
import { EmptyState } from "./EmptyState";
import { SkeletonState } from "./SkeletonState";
import { ErrorState } from "./ErrorState";

export interface EscalationTableProps {
  escalations: Escalation[] | null;
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (investigationId: string) => void;
}

export function EscalationTable({ escalations, error, onRetry, onSelect }: EscalationTableProps) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (escalations === null) return <SkeletonState rows={3} />;
  if (escalations.length === 0) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Queue is clear"
        description="Nothing needs human attention right now."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {escalations.map((esc) => (
        <li key={esc.investigation_id}>
          <button
            onClick={() => onSelect?.(esc.investigation_id)}
            className="flex w-full flex-col gap-2 rounded-xl border-2 border-border bg-surface-1 p-3 text-left shadow-brutal-sm transition-transform hover:-translate-y-0.5 hover:shadow-brutal"
          >
            <div className="flex items-start justify-between gap-2">
              <SeverityBadge severity={esc.severity} />
              <span className="flex-none font-mono text-xs text-text-muted">
                {formatRelativeTime(esc.created_at)}
              </span>
            </div>
            <div>
              <div className="truncate font-display text-sm font-bold text-text-primary">
                {esc.title}
              </div>
              <div className="font-mono text-xs text-text-muted">#{esc.number}</div>
            </div>
            <p className="text-xs text-text-secondary">{esc.reason}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}
