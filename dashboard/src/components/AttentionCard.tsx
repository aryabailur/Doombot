import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bookmark, Crosshair, Gauge, ShieldQuestion } from "lucide-react";
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

// severity is a real computed field (adapters.ts severityFromDecision); this
// is an honest relabeling of it for display, not a second invented metric.
const IMPACT_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Relevance to *external* evidence only — the issue's citation of itself
// (score 1.0 by construction) would otherwise trivially max this out on
// every card regardless of how much real corroborating evidence exists.
// Uses each ref's real `score` (present for every evidence type: security
// keyword matches, impact signals, duplicates, etc), not just the narrower
// similarity/relevance fields that only RAG-style matches carry.
function topRelevance(evidence: Investigation["evidence"]): number | null {
  const scores = evidence.map((e) => e.score ?? e.similarity ?? e.relevance).filter((s): s is number => s !== undefined);
  if (scores.length === 0) return null;
  return Math.max(...scores);
}

export function AttentionCard({ investigation, style }: AttentionCardProps & { style?: React.CSSProperties }) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const accent = SEVERITY_ACCENT[investigation.severity ?? "medium"];
  const impact = IMPACT_LABEL[investigation.severity ?? "medium"];
  // Drop the issue's self-citation ({type:"issue", ref:"<this number>"}) —
  // real data, but not useful "evidence" for a maintainer since it's the
  // issue referencing itself, not an external source the agent found.
  const externalEvidence = investigation.evidence.filter(
    (ev) => !(ev.kind === "issue" && ev.id === String(investigation.number))
  );
  const relevance = topRelevance(externalEvidence);

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
          <DecisionBadge decision={investigation.decision} confidence={investigation.confidence} layout="stacked" />
        </div>
      </div>

      {investigation.category && (
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{investigation.category}</p>
      )}

      <p className="text-sm leading-relaxed text-ink/80">{investigation.reason}</p>

      {investigation.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {investigation.labels.map((label) => (
            <span
              key={label}
              className="rounded-md bg-background px-2 py-0.5 font-mono text-[11px] font-semibold text-ink/70"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {externalEvidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {externalEvidence.slice(0, 4).map((ev, i) => (
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

      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
            <Crosshair className="h-3 w-3" strokeWidth={2.25} />
            Relevance
          </span>
          <span className="font-mono text-sm font-bold text-ink">
            {relevance !== null ? `${Math.round(relevance * 100)}%` : "—"}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1 border-x border-border text-center">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
            <ShieldQuestion className="h-3 w-3" strokeWidth={2.25} />
            Impact
          </span>
          <span className="font-mono text-sm font-bold text-ink">{impact}</span>
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
            <Gauge className="h-3 w-3" strokeWidth={2.25} />
            Confidence
          </span>
          <span className="font-mono text-sm font-bold text-ink">
            {Math.round(investigation.confidence * 100)}%
          </span>
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={() => navigate(`/issue/${investigation.id}`)}
          className="inline-flex w-fit items-center gap-1.5 overflow-hidden rounded-lg bg-ink px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-white transition-all duration-300 hover:-translate-y-0.5 hover:gap-2.5 hover:bg-accent hover:shadow-flat-sm"
        >
          {ACTION_LABEL[investigation.decision]}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2.5} />
        </button>
        <button
          onClick={() => setSaved((s) => !s)}
          aria-label={saved ? "Remove from saved" : "Save for later"}
          aria-pressed={saved}
          className={`inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg border transition-colors ${
            saved ? "border-ink bg-ink text-white" : "border-border bg-card text-muted hover:text-ink"
          }`}
        >
          <Bookmark className="h-3.5 w-3.5" strokeWidth={2.25} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
    </div>
  );
}
