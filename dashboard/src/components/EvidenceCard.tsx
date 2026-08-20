import { FileText, CircleDot, GitPullRequest, ShieldAlert, Hash } from "lucide-react";
import type { Evidence } from "../lib/types";

export interface EvidenceCardProps {
  evidence: Evidence;
}

const TYPE_ICON: Record<string, typeof FileText> = {
  file: FileText,
  issue: CircleDot,
  pr: GitPullRequest,
  security: ShieldAlert,
  duplicate: Hash,
};

export function EvidenceCard({ evidence }: EvidenceCardProps) {
  const Icon = TYPE_ICON[evidence.type] ?? Hash;
  const pct = Math.round(evidence.score * 100);
  return (
    <div className="rounded-lg border-2 border-border bg-surface-1 p-3 shadow-brutal-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-secondary">
          <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
          {evidence.type}
        </div>
        <span className="rounded border-2 border-border bg-information px-1.5 py-0.5 font-mono text-xs font-bold text-white">
          {pct}%
        </span>
      </div>
      <div className="mb-1 font-mono text-xs font-semibold text-text-primary">{evidence.ref}</div>
      <p className="font-mono text-xs leading-relaxed text-text-secondary">{evidence.snippet}</p>
    </div>
  );
}
