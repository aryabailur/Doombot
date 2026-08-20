import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { Investigation } from "../lib/seed";
import { DecisionBadge } from "./DecisionBadge";
import { EvidenceChip } from "./EvidenceChip";

export interface AttentionCardProps {
  investigation: Investigation;
}

const SEVERITY_ACCENT: Record<string, string> = {
  critical: "border-l-danger",
  high: "border-l-security",
  medium: "border-l-warning",
  low: "border-l-info",
};

const ACTION_LABEL: Record<Investigation["decision"], string> = {
  escalate: "Open Investigation",
  followup: "View Follow-Up",
  silent: "Why?",
  duplicate: "View Duplicate",
  insufficient: "Review",
};

export function AttentionCard({ investigation, style }: AttentionCardProps & { style?: React.CSSProperties }) {
  const navigate = useNavigate();
  const accent = SEVERITY_ACCENT[investigation.severity ?? "medium"];

  return (
    <div
      style={style}
      className={`card-lift animate-stagger-in group flex flex-col gap-3 rounded-2xl border border-border border-l-4 bg-card p-6 shadow-flat-sm ${accent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-mono text-xs text-muted">#{investigation.number}</span>
          <h3 className="mt-0.5 text-lg font-bold leading-snug text-ink">{investigation.title}</h3>
        </div>
        <div className="animate-decision-pop">
          <DecisionBadge decision={investigation.decision} confidence={investigation.confidence} size="sm" />
        </div>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{investigation.category}</p>

      <p className="text-sm leading-relaxed text-ink/80">{investigation.reason}</p>

      {investigation.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {investigation.evidence.slice(0, 3).map((ev, i) => (
            <span
              key={ev.id}
              className="animate-stagger-in"
              style={{ "--stagger-i": i } as React.CSSProperties}
            >
              <EvidenceChip evidence={ev} />
            </span>
          ))}
        </div>
      )}

      <button
        onClick={() => navigate(`/issue/${investigation.id}`)}
        className="mt-1 inline-flex w-fit items-center gap-1.5 overflow-hidden rounded-lg bg-ink px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-white transition-all duration-300 hover:-translate-y-0.5 hover:gap-2.5 hover:bg-accent hover:shadow-flat-sm"
      >
        {ACTION_LABEL[investigation.decision]}
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
