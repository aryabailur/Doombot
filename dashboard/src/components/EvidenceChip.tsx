import { CircleDot, GitPullRequest, ScrollText, GitCommit } from "lucide-react";
import type { EvidenceRef } from "../lib/seed";

export interface EvidenceChipProps {
  evidence: EvidenceRef;
  onClick?: (evidence: EvidenceRef) => void;
}

const KIND_ICON: Record<EvidenceRef["kind"], typeof CircleDot> = {
  issue: CircleDot,
  pr: GitPullRequest,
  decision: ScrollText,
  commit: GitCommit,
};

export function EvidenceChip({ evidence, onClick }: EvidenceChipProps) {
  const Icon = KIND_ICON[evidence.kind];
  const pct = evidence.similarity ?? evidence.relevance;
  const label = evidence.kind === "pr" ? `PR #${evidence.id}` : evidence.kind === "commit" ? evidence.id : `#${evidence.id}`;

  return (
    <button
      onClick={() => onClick?.(evidence)}
      className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs font-medium text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-ink hover:bg-background hover:shadow-flat-sm active:translate-y-0"
      title={evidence.label}
    >
      <Icon className="h-3 w-3 text-muted transition-transform duration-200 group-hover:scale-110 group-hover:text-ink" strokeWidth={2.25} />
      {label}
      {pct !== undefined && <span className="text-muted">· {Math.round(pct * 100)}%</span>}
      {pct !== undefined && (
        <span
          className="absolute bottom-0 left-0 h-[2px] bg-accent transition-all duration-500 ease-out"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      )}
    </button>
  );
}
