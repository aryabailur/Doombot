import { useEffect, useRef, useState } from "react";
import { Search, BadgeCheck, ThumbsUp, ThumbsDown } from "lucide-react";
import type { StepRecord, WsEnvelope } from "../lib/types";
import { useSocket } from "../lib/useSocket";
import { getInvestigation, postFeedback } from "../lib/api";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { InvestigationStep } from "./InvestigationStep";
import { EmptyState } from "./EmptyState";
import { SkeletonState } from "./SkeletonState";

export interface InvestigationTraceProps {
  investigationId: string;
  initialSteps: StepRecord[];
  live?: boolean;
  decisionReason?: string | null;
  confidence?: number | null;
  className?: string;
}

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";

export function InvestigationTrace({
  investigationId,
  initialSteps,
  live = false,
  decisionReason,
  confidence,
  className = "",
}: InvestigationTraceProps) {
  const [steps, setSteps] = useState<StepRecord[]>(initialSteps);
  const [feedbackGiven, setFeedbackGiven] = useState<"up" | "down" | null>(null);
  const wasReconnecting = useRef(false);

  useEffect(() => {
    setSteps(initialSteps);
  }, [investigationId, initialSteps]);

  const handleEvent = (envelope: WsEnvelope) => {
    if (envelope.type !== "step.started" && envelope.type !== "step.completed") return;
    const step = envelope.data as StepRecord;
    if (step.investigation_id !== investigationId) return;
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.step_id === step.step_id);
      if (idx === -1) return [...prev, step].sort((a, b) => a.seq - b.seq);
      const next = [...prev];
      next[idx] = step;
      return next;
    });
  };

  const { connectionState } = useSocket({ url: WS_URL, onEvent: handleEvent, enabled: live });

  useEffect(() => {
    if (connectionState === "reconnecting") wasReconnecting.current = true;
    if (connectionState === "connected" && wasReconnecting.current) {
      wasReconnecting.current = false;
      getInvestigation(investigationId)
        .then((detail) => setSteps(detail.steps))
        .catch(() => {});
    }
  }, [connectionState, investigationId]);

  async function sendFeedback(verdict: "up" | "down") {
    setFeedbackGiven(verdict);
    try {
      await postFeedback({ investigation_id: investigationId, verdict });
    } catch {
      // logged only; failure here is non-critical to the demo
    }
  }

  if (steps.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No steps yet"
        description="This investigation hasn't produced any chain steps."
      />
    );
  }

  return (
    <div className={className}>
      <div className="mb-4">
        {steps.map((step, i) => (
          <InvestigationStep key={step.step_id} step={step} isLast={i === steps.length - 1} />
        ))}
      </div>

      {decisionReason && (
        <div className="rounded-xl border-2 border-border bg-accent-muted p-4 shadow-brutal">
          <div className="mb-2 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-accent" strokeWidth={2.5} />
            <h4 className="font-display text-sm font-bold uppercase tracking-wide">Decision</h4>
            {confidence !== undefined && <ConfidenceIndicator score={confidence ?? null} />}
          </div>
          <p className="text-sm text-text-secondary">{decisionReason}</p>

          <div className="mt-4 flex items-center gap-2 border-t-2 border-border pt-3">
            <span className="text-xs font-semibold text-text-muted">Was this helpful?</span>
            <button
              onClick={() => sendFeedback("up")}
              aria-label="Thumbs up"
              className={`flex h-8 w-8 items-center justify-center rounded-lg border-2 border-border shadow-brutal-sm transition-transform hover:-translate-y-0.5 ${
                feedbackGiven === "up" ? "bg-success text-white" : "bg-surface-1"
              }`}
            >
              <ThumbsUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <button
              onClick={() => sendFeedback("down")}
              aria-label="Thumbs down"
              className={`flex h-8 w-8 items-center justify-center rounded-lg border-2 border-border shadow-brutal-sm transition-transform hover:-translate-y-0.5 ${
                feedbackGiven === "down" ? "bg-critical text-white" : "bg-surface-1"
              }`}
            >
              <ThumbsDown className="h-4 w-4" strokeWidth={2.5} />
            </button>
            {feedbackGiven && <span className="text-xs text-text-muted">Feedback logged.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export { SkeletonState as InvestigationTraceSkeleton };
