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
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs font-medium text-ink transition-colors hover:border-ink hover:bg-background"
      title={evidence.label}
    >
      <Icon className="h-3 w-3 text-muted" strokeWidth={2.25} />
      {label}
      {pct !== undefined && <span className="text-muted">· {Math.round(pct * 100)}%</span>}
    </button>
  );
}
