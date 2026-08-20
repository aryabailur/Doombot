import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ThumbsUp, ThumbsDown, BadgeCheck, AlertTriangle } from "lucide-react";
import { getInvestigation, postFeedback, listActions } from "../lib/api";
import { detailToInvestigation } from "../lib/adapters";
import { useSocket } from "../lib/useSocket";
import type { Investigation } from "../lib/seed";
import type { WsEnvelope, SuggestedActionApi } from "../lib/types";
import { DecisionBadge } from "../components/DecisionBadge";
import { ConfidenceRing } from "../components/ConfidenceRing";
import { AgentRunTimeline } from "../components/AgentRunTimeline";
import { EvidenceGraph } from "../components/EvidenceGraph";
import { EvidenceChip } from "../components/EvidenceChip";
import { ActionApproval } from "../components/ActionApproval";

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";

export function IssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [pendingActions, setPendingActions] = useState<SuggestedActionApi[]>([]);

  function load() {
    if (!id) return;
    getInvestigation(id)
      .then((detail) => setInvestigation(detailToInvestigation(detail)))
      .catch(() => setError("Could not load this investigation."));
    listActions(undefined, "pending")
      .then((all) => setPendingActions(all.filter((a) => a.investigation_id === id)))
      .catch(() => setPendingActions([]));
  }

  useEffect(() => {
    setInvestigation(null);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useSocket({
    url: WS_URL,
    onEvent: (envelope: WsEnvelope) => {
      if (envelope.type === "step.completed" || envelope.type === "investigation.completed") {
        const data = envelope.data as { investigation_id?: string };
        if (data.investigation_id === id) load();
      }
    },
  });

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={() => navigate(-1)} className="flex w-fit items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
          Back
        </button>
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!investigation) {
    return (
      <div className="flex flex-col gap-6">
        <div className="skeleton-block h-4 w-24" />
        <div className="flex flex-col gap-2">
          <div className="skeleton-block h-4 w-16" />
          <div className="skeleton-block h-8 w-96" />
        </div>
        <div className="skeleton-block h-32 w-full rounded-2xl" />
        <div className="skeleton-block h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const isSilent = investigation.decision === "silent";
  const isInsufficient = investigation.decision === "insufficient";

  async function sendFeedback(verdict: "up" | "down") {
    setFeedback(verdict);
    if (!id) return;
    try {
      await postFeedback({ investigation_id: id, verdict });
    } catch {
      // logged only; non-critical
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <button onClick={() => navigate(-1)} className="flex w-fit items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
        Back to Attention
      </button>

      <div>
        <span className="font-mono text-sm text-muted">#{investigation.number}</span>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">{investigation.title}</h1>
        <p className="mt-1 text-sm text-muted">{investigation.category}</p>
      </div>

      <div
        className={`flex flex-col gap-4 rounded-2xl border border-border p-8 shadow-flat sm:flex-row sm:items-center sm:justify-between ${
          isSilent ? "bg-success-soft" : isInsufficient ? "bg-background" : "bg-danger-soft"
        }`}
      >
        <div>
          <DecisionBadge decision={investigation.decision} size="lg" />
          {investigation.reason && <p className="mt-3 max-w-xl text-lg font-medium text-ink">"{investigation.reason}"</p>}
          {isSilent && (
            <p className="mt-3 text-sm font-bold uppercase tracking-wide text-success">Maintainer interruption avoided</p>
          )}
        </div>
        <ConfidenceRing value={investigation.confidence} label="Confidence" size={104} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted">Agent Investigation</h2>
        {investigation.steps.length === 0 ? (
          <p className="text-sm text-muted">No steps recorded yet.</p>
        ) : (
          <AgentRunTimeline steps={investigation.steps} totalPlannedSteps={6} />
        )}
      </div>

      {investigation.evidence.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">Evidence Graph</h2>
          <EvidenceGraph
            centerLabel={`#${investigation.number}`}
            nodes={investigation.evidence}
            decision={investigation.decision}
            confidence={investigation.confidence}
          />
        </div>
      )}

      {investigation.evidence.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted">Evidence</h2>
          <div className="flex flex-wrap gap-1.5">
            {investigation.evidence.map((ev, i) => (
              <EvidenceChip key={i} evidence={ev} />
            ))}
          </div>
        </div>
      )}

      {(() => {
        // Ground truth for "did a real GitHub write happen" is the steps'
        // tool_calls — evidence snippets alone can't be trusted here (a
        // label evidence item exists whether or not the actual API call
        // succeeded). A write was attempted whenever labeler/decider ran
        // with a decision that calls GitHub (auto-apply labels above
        // threshold, close_as_duplicate, or auto_comment); it actually
        // succeeded only if the corresponding tool name shows up in
        // tool_calls for that step.
        const writeAttemptingSteps = investigation.steps.filter(
          (s) => s.name === "labeler" || s.name === "decider"
        );
        const attemptedWrite = investigation.evidence.some(
          (ev) => ev.kind === "decision" && (ev.label?.includes("applied") || ev.label?.includes("suggested"))
        ) || ["duplicate", "silent"].includes(investigation.decision);
        const anyToolCallFired = writeAttemptingSteps.some((s) => (s.toolCalls?.length ?? 0) > 0);
        const anyApplyFailed = investigation.evidence.some(
          (ev) => ev.kind === "decision" && ev.label === "apply_failed"
        );

        if (!attemptedWrite) return null;

        if (anyToolCallFired && !anyApplyFailed) {
          return (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
              <div className="mb-3 flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-success" strokeWidth={2.25} />
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink">
                  Already Applied (Auto-Approved)
                </h3>
              </div>
              <p className="text-xs text-muted">
                High-confidence labels (≥85%) and duplicate/acknowledgement comments were sent to
                GitHub automatically. Lower-confidence and security-sensitive suggestions wait for
                your approval below.
              </p>
            </div>
          );
        }

        return (
          <div className="rounded-2xl border border-border bg-danger-soft p-6 shadow-flat-sm">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-danger" strokeWidth={2.25} />
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink">
                GitHub Write Failed
              </h3>
            </div>
            <p className="text-xs text-ink/70">
              The agent decided to label or comment on this issue, but the GitHub API call did not
              succeed (no write access, rate limit, or a network error). Nothing was actually
              posted — apply it manually if it's still correct.
            </p>
          </div>
        );
      })()}

      <ActionApproval actions={pendingActions} onResolved={() => load()} />

      {pendingActions.length === 0 && investigation.decision === "escalate" && (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted shadow-flat-sm">
          No pending GitHub actions for this investigation — review and respond on GitHub directly.
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <span className="text-xs font-semibold text-muted">Correct this decision?</span>
        <button
          onClick={() => sendFeedback("up")}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors ${
            feedback === "up" ? "bg-success text-white" : "bg-card text-muted"
          }`}
          aria-label="Agree with decision"
        >
          <ThumbsUp className="h-4 w-4" strokeWidth={2.25} />
        </button>
        <button
          onClick={() => sendFeedback("down")}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors ${
            feedback === "down" ? "bg-danger text-white" : "bg-card text-muted"
          }`}
          aria-label="Mark decision wrong"
        >
          <ThumbsDown className="h-4 w-4" strokeWidth={2.25} />
        </button>
        {feedback && <span className="text-xs text-muted">Feedback logged.</span>}
      </div>
    </div>
  );
}
