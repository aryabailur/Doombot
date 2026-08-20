import { CircleDot, GitPullRequest, Search } from "lucide-react";
import type { InvestigationSummary } from "../lib/types";
import { formatRelativeTime } from "../lib/format";
import { EmptyState } from "./EmptyState";
import { SkeletonState } from "./SkeletonState";
import { ErrorState } from "./ErrorState";

export interface InvestigationListProps {
  investigations: InvestigationSummary[] | null;
  error?: string | null;
  onRetry?: () => void;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

// `animate-pulse-dot` came from Stream A's own stylesheet and is not defined
// on main, so it rendered as a dead class. motion-safe:animate-pulse is the
// standard utility and respects prefers-reduced-motion, which a custom
// keyframe would have had to opt into manually.
const STATUS_DOT: Record<string, string> = {
  running: "bg-information motion-safe:animate-pulse",
  done: "bg-success",
  error: "bg-critical",
};

export function InvestigationList({
  investigations,
  error,
  onRetry,
  selectedId,
  onSelect,
}: InvestigationListProps) {
  // `kind` is required on main's ErrorState: it selects the shared copy for
  // each failure mode so every screen words the same failure identically.
  if (error) return <ErrorState kind="unknown" message={error} onRetry={onRetry} />;
  if (investigations === null) return <SkeletonState count={4} variant="list" />;
  if (investigations.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No investigations yet"
        description="Trigger one from a repo to see the agent's reasoning chain here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {investigations.map((inv) => {
        const Icon = inv.kind === "issue" ? CircleDot : GitPullRequest;
        const isSelected = inv.investigation_id === selectedId;
        return (
          <li key={inv.investigation_id}>
            <button
              onClick={() => onSelect(inv.investigation_id)}
              className={`flex w-full items-start gap-3 rounded-xl border-2 border-border p-3 text-left shadow-brutal-sm transition-transform hover:-translate-y-0.5 hover:shadow-brutal ${
                isSelected ? "bg-accent-muted" : "bg-surface-1"
              }`}
            >
              <span
                className={`mt-1 h-2.5 w-2.5 flex-none rounded-full border border-border ${STATUS_DOT[inv.status] ?? "bg-neutral"}`}
                aria-hidden
              />
              <Icon className="mt-0.5 h-4 w-4 flex-none text-text-muted" strokeWidth={2.5} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-display text-sm font-bold text-text-primary">
                    {inv.title}
                  </span>
                  <span className="flex-none font-mono text-xs text-text-muted">
                    #{inv.number}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                  <span className="truncate">{inv.repo_name}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(inv.created_at)}</span>
                  {inv.decision && (
                    <>
                      <span>·</span>
                      <span className="font-semibold text-text-secondary">{inv.decision}</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
