import { useState } from "react";
import { ChevronDown, Wrench, X, SkipForward } from "lucide-react";
import type { AgentStep } from "../lib/seed";
import { EvidenceChip } from "./EvidenceChip";

export interface AgentRunTimelineProps {
  steps: AgentStep[];
  activeStep?: number;
  /** Total nodes the graph would run if nothing failed — used to render
   * "skipped" placeholders for steps that never got a chance to run
   * because an earlier step errored and stopped the chain. */
  totalPlannedSteps?: number;
}

export function AgentRunTimeline({ steps, activeStep, totalPlannedSteps }: AgentRunTimelineProps) {
  const [expanded, setExpanded] = useState<number | null>(steps.length - 1);
  const lastStep = steps[steps.length - 1];
  const stoppedEarly = lastStep?.status === "error";
  const skippedCount =
    stoppedEarly && totalPlannedSteps ? Math.max(0, totalPlannedSteps - steps.length) : 0;

  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const isActive = activeStep === step.seq;
        const isOpen = expanded === i;
        const isError = step.status === "error";
        const isLast = i === steps.length - 1 && skippedCount === 0;
        return (
          <li
            key={step.seq}
            className={`relative flex gap-4 rounded-lg pb-6 ${isLast ? "" : ""} ${isActive ? "animate-step-glow" : ""}`}
          >
            {(i < steps.length - 1 || skippedCount > 0) && (
              <div className={`absolute top-8 left-[15px] h-full w-px ${isError ? "bg-danger/40" : "bg-border"}`} />
            )}
            <div
              className={`relative z-10 flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 font-mono text-xs font-bold ${
                isError
                  ? "border-danger bg-danger text-white"
                  : isActive
                    ? "animate-pulse-dot border-ink bg-info text-white"
                    : "border-ink bg-card text-ink"
              }`}
            >
              {isError ? <X className="h-4 w-4" strokeWidth={3} /> : String(step.seq).padStart(2, "0")}
            </div>
            <div className="min-w-0 flex-1">
              <button
                onClick={() => setExpanded(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div>
                  <span className={`text-sm font-bold uppercase tracking-wide ${isError ? "text-danger" : "text-ink"}`}>
                    {step.title}
                  </span>
                  {isError && (
                    <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
                      Failed
                    </span>
                  )}
                  <span className="ml-2 font-mono text-xs text-muted">{step.ts}</span>
                </div>
                <ChevronDown className={`h-4 w-4 flex-none text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="mt-1.5 animate-rise-in">
                  <p className={`text-sm ${isError ? "font-mono text-xs text-danger" : "text-ink/75"}`}>{step.detail}</p>
                  {step.toolCalls && step.toolCalls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {step.toolCalls.map((tool) => (
                        <span
                          key={tool}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-lilac px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink"
                        >
                          <Wrench className="h-3 w-3" />
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                  {step.sources && step.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {step.sources.map((s) => (
                        <EvidenceChip key={s.id} evidence={s} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}

      {skippedCount > 0 && (
        <li className="relative flex gap-4 pb-0 opacity-50">
          <div className="relative z-10 flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 border-dashed border-muted bg-card text-muted">
            <SkipForward className="h-3.5 w-3.5" strokeWidth={2.25} />
          </div>
          <div className="flex items-center">
            <span className="text-sm font-bold uppercase tracking-wide text-muted">
              {skippedCount} step{skippedCount === 1 ? "" : "s"} skipped — chain stopped after the failure above
            </span>
          </div>
        </li>
      )}
    </ol>
  );
}
