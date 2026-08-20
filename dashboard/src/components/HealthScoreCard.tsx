import { Activity } from "lucide-react";
import type { HealthResponse } from "../lib/types";
import { SkeletonState } from "./SkeletonState";

export interface HealthScoreCardProps {
  health: HealthResponse | null;
}

const BREAKDOWN_LABELS: [key: keyof HealthResponse["breakdown"], label: string][] = [
  ["security", "Security"],
  ["staleness", "Staleness"],
  ["duplication", "Duplication"],
  ["responsiveness", "Responsiveness"],
];

function scoreColor(score: number) {
  if (score >= 80) return "bg-success";
  if (score >= 50) return "bg-warning";
  return "bg-critical";
}

export function HealthScoreCard({ health }: HealthScoreCardProps) {
  if (!health) return <SkeletonState rows={1} />;

  return (
    <div className="rounded-xl border-2 border-border bg-surface-1 p-4 shadow-brutal">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-accent" strokeWidth={2.5} />
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">Repo Health</h3>
      </div>

      <div className="mb-4 flex items-end gap-2">
        <span className="font-display text-5xl font-extrabold leading-none">
          {Math.round(health.score)}
        </span>
        <span className="mb-1 text-sm font-semibold text-text-muted">/ 100</span>
      </div>

      <div className="flex flex-col gap-2">
        {BREAKDOWN_LABELS.map(([key, label]) => {
          const val = health.breakdown[key];
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs font-semibold text-text-secondary">
                <span>{label}</span>
                <span className="font-mono">{Math.round(val)}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full border-2 border-border bg-surface-2">
                <div
                  className={`h-full ${scoreColor(val)}`}
                  style={{ width: `${Math.max(0, Math.min(100, val))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
