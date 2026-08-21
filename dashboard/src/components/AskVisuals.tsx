import {
  CircleDot,
  GitPullRequest,
  Copy,
  ShieldAlert,
  Gauge,
  Tag,
  ScrollText,
  GitCommit,
  FileCode,
} from "lucide-react";
import type { AskVisual, AskCitation } from "../lib/types";

// Mirrors EvidenceGraph's TYPE_META icon/color choices so the same
// evidence.type string always reads the same way across the app.
const CITATION_TYPE_META: Record<string, { icon: typeof CircleDot; color: string }> = {
  issue: { icon: CircleDot, color: "var(--info)" },
  pr: { icon: GitPullRequest, color: "var(--accent)" },
  duplicate: { icon: Copy, color: "var(--info)" },
  security: { icon: ShieldAlert, color: "var(--danger)" },
  impact: { icon: Gauge, color: "var(--warning)" },
  label: { icon: Tag, color: "var(--muted)" },
  decision: { icon: ScrollText, color: "var(--success)" },
  commit: { icon: GitCommit, color: "var(--muted)" },
};

export function citationMeta(type: string) {
  return CITATION_TYPE_META[type] ?? { icon: ScrollText, color: "var(--muted)" };
}

function evidenceBarColor(type: string): string {
  return citationMeta(type).color;
}

export function confidenceBand(value: number): string {
  if (value >= 0.85) return "High confidence";
  if (value >= 0.6) return "Moderate confidence";
  if (value >= 0.35) return "Low confidence";
  return "Very low confidence";
}

function EvidenceBarVisual({ data }: { data: Record<string, unknown> }) {
  const items = (data.items as { label: string; value: number; type: string }[] | undefined) ?? [];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div
          key={`${item.label}-${i}`}
          className="animate-stagger-in flex items-center gap-3"
          style={{ "--stagger-i": i } as React.CSSProperties}
        >
          <span className="w-32 flex-none truncate text-xs font-medium text-ink/80" title={item.label}>
            {item.label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.round(item.value * 100)}%`, backgroundColor: evidenceBarColor(item.type) }}
            />
          </div>
          <span className="w-10 flex-none text-right font-mono text-xs text-muted">
            {Math.round(item.value * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function SimilarIncidentsVisual({ data }: { data: Record<string, unknown> }) {
  const items = (data.items as { number: number; title: string; score: number }[] | undefined) ?? [];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div
          key={item.number}
          className="animate-stagger-in flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2"
          style={{ "--stagger-i": i } as React.CSSProperties}
        >
          <span className="flex-none font-mono text-xs font-bold text-muted">#{item.number}</span>
          <span className="flex-1 truncate text-xs text-ink/80" title={item.title}>
            {item.title}
          </span>
          <div className="h-1.5 w-14 flex-none overflow-hidden rounded-full bg-border/60">
            <div
              className="h-full rounded-full bg-info transition-all duration-500 ease-out"
              style={{ width: `${Math.round(item.score * 100)}%` }}
            />
          </div>
          <span className="w-9 flex-none text-right font-mono text-[11px] text-muted">
            {Math.round(item.score * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function ArchitectureImpactVisual({ data }: { data: Record<string, unknown> }) {
  const files = (data.matched_files as string[] | undefined) ?? [];
  const note = data.note as string | undefined;
  if (files.length === 0) {
    if (!note) return null;
    return <p className="text-sm text-muted">{note}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {files.map((file, i) => (
        <div
          key={file}
          className="animate-stagger-in flex items-center gap-2 font-mono text-xs text-ink/80"
          style={{ "--stagger-i": i } as React.CSSProperties}
        >
          <FileCode className="h-3.5 w-3.5 flex-none text-muted" strokeWidth={2.25} />
          <span className="truncate" title={file}>
            {file}
          </span>
        </div>
      ))}
    </div>
  );
}

interface PrecedentData {
  total: number;
  by_decision: { escalate: number; close_as_duplicate: number; auto_comment: number; hold: number };
  most_similar_reason: string | null;
}

const PRECEDENT_LABELS: Record<keyof PrecedentData["by_decision"], string> = {
  escalate: "Escalated",
  close_as_duplicate: "Closed as duplicate",
  auto_comment: "Auto-commented",
  hold: "Held",
};

function PrecedentVisual({ data }: { data: Record<string, unknown> }) {
  const total = data.total as number | undefined;
  const byDecision = data.by_decision as PrecedentData["by_decision"] | undefined;
  const mostSimilarReason = data.most_similar_reason as string | null | undefined;
  if (!total && !byDecision) return null;
  return (
    <div className="flex flex-col gap-3">
      {total !== undefined && (
        <p className="text-xs font-semibold text-ink/80">
          <span className="font-mono text-base font-extrabold text-ink">{total}</span> similar precedent
          {total === 1 ? "" : "s"} in project memory
        </p>
      )}
      {byDecision && (
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(PRECEDENT_LABELS) as (keyof PrecedentData["by_decision"])[]).map((key) => (
            <div key={key} className="rounded-lg border border-border bg-background px-2.5 py-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{PRECEDENT_LABELS[key]}</p>
              <p className="font-mono text-sm font-bold text-ink">{byDecision[key] ?? 0}</p>
            </div>
          ))}
        </div>
      )}
      {mostSimilarReason && (
        <p className="border-l-2 border-border pl-3 text-sm italic text-ink/70">"{mostSimilarReason}"</p>
      )}
    </div>
  );
}

const VISUAL_TITLES: Record<string, string> = {
  evidence_bar: "Evidence",
  similar_incidents: "Similar incidents",
  architecture_impact: "Architecture impact",
  precedent: "Maintainer precedent",
  code_path: "Code path",
};

export function VisualBlock({ visual, index }: { visual: AskVisual; index: number }) {
  let body: React.ReactNode = null;
  if (visual.kind === "evidence_bar") body = <EvidenceBarVisual data={visual.data} />;
  else if (visual.kind === "similar_incidents") body = <SimilarIncidentsVisual data={visual.data} />;
  else if (visual.kind === "architecture_impact") body = <ArchitectureImpactVisual data={visual.data} />;
  else if (visual.kind === "precedent") body = <PrecedentVisual data={visual.data} />;
  else {
    // code_path is defined in the schema but has no real producer yet —
    // render generically rather than building special-case UI for it.
    const entries = Object.entries(visual.data);
    if (entries.length === 0) return null;
    body = (
      <div className="flex flex-col gap-1 font-mono text-xs text-ink/70">
        {entries.map(([key, value]) => (
          <div key={key}>
            <span className="text-muted">{key}:</span> {JSON.stringify(value)}
          </div>
        ))}
      </div>
    );
  }
  if (!body) return null;
  return (
    <div
      className="animate-stagger-in rounded-xl border border-border bg-card p-4 shadow-flat-sm"
      style={{ "--stagger-i": index } as React.CSSProperties}
    >
      <p className="mb-2.5 text-xs font-bold uppercase tracking-widest text-muted">
        {VISUAL_TITLES[visual.kind] ?? visual.kind}
      </p>
      {body}
    </div>
  );
}

export function CitationRow({ citation, index }: { citation: AskCitation; index: number }) {
  const meta = citationMeta(citation.type);
  const Icon = meta.icon;
  const label = citation.number !== null ? `#${citation.number}` : citation.ref;
  return (
    <div
      className="animate-stagger-in inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs font-medium text-ink"
      style={{ "--stagger-i": index } as React.CSSProperties}
      title={citation.snippet}
    >
      <Icon className="h-3 w-3" strokeWidth={2.25} style={{ color: meta.color }} />
      {label}
      {citation.score !== null && <span className="text-muted">· {Math.round(citation.score * 100)}%</span>}
    </div>
  );
}

export const ACTION_LABEL: Record<string, string> = {
  open_investigation: "Open Investigation",
  view_code_path: "View Code Path",
  view_architecture: "View Architecture",
};
