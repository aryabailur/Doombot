import { useState } from "react";
import { ChevronDown, CircleCheck, CircleX, Loader2 } from "lucide-react";
import type { StepRecord } from "../lib/types";
import { formatDuration } from "../lib/format";
import { EvidenceCard } from "./EvidenceCard";

export interface InvestigationStepProps {
  step: StepRecord;
  isLast: boolean;
}

const STATUS_STYLE: Record<
  StepRecord["status"],
  { dot: string; icon: typeof CircleCheck; label: string }
> = {
  running: { dot: "bg-information", icon: Loader2, label: "Running" },
  done: { dot: "bg-success", icon: CircleCheck, label: "Done" },
  error: { dot: "bg-critical", icon: CircleX, label: "Error" },
};

export function InvestigationStep({ step, isLast }: InvestigationStepProps) {
  const [expanded, setExpanded] = useState(step.status === "running");
  const { dot, icon: Icon, label } = STATUS_STYLE[step.status];
  const hasEvidence = step.evidence.length > 0;

  return (
    <div className="relative flex gap-4 pb-6">
      {!isLast && <div className="absolute top-9 left-[19px] h-full w-0.5 bg-border" />}

      <div
        className={`relative z-10 flex h-10 w-10 flex-none items-center justify-center rounded-full border-2 border-border shadow-brutal-sm ${dot}`}
      >
        <Icon
          className={`h-5 w-5 text-white ${step.status === "running" ? "animate-spin" : ""}`}
          strokeWidth={2.5}
        />
      </div>

      <div className="min-w-0 flex-1 animate-slide-in rounded-xl border-2 border-border bg-surface-1 shadow-brutal-sm">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={expanded}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-bold text-text-primary">{step.title}</span>
              <span
                className={`rounded border-2 border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  step.status === "error" ? "bg-critical text-white" : "bg-surface-2 text-text-secondary"
                }`}
              >
                {label}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-text-muted">{step.input_summary}</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span className="font-mono text-xs text-text-muted">{formatDuration(step.duration_ms)}</span>
            <ChevronDown
              className={`h-4 w-4 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </div>
        </button>

        {expanded && (
          <div className="border-t-2 border-border px-4 py-3">
            {step.output_summary && (
              <p className="mb-3 text-sm text-text-secondary">{step.output_summary}</p>
            )}
            {hasEvidence ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {step.evidence.map((ev, i) => (
                  <EvidenceCard key={i} evidence={ev} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted italic">No evidence attached to this step.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
