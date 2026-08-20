import { useState } from "react";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type { SuggestedActionApi } from "../lib/types";
import { approveAction, rejectAction } from "../lib/api";

export interface ActionApprovalProps {
  actions: SuggestedActionApi[];
  onResolved?: (actionId: string, status: "approved" | "rejected") => void;
}

function describeAction(action: SuggestedActionApi): string {
  if (action.kind === "add_labels") {
    const labels = action.payload.labels ?? [];
    return `Apply label${labels.length > 1 ? "s" : ""}: ${labels.join(", ")}`;
  }
  return `Post comment: "${action.payload.comment ?? ""}"`;
}

export function ActionApproval({ actions, onResolved }: ActionApprovalProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, "approved" | "rejected">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pending = actions.filter((a) => !resolved[a.action_id]);

  async function handle(action: SuggestedActionApi, kind: "approve" | "reject") {
    setBusy(action.action_id);
    setErrors((e) => ({ ...e, [action.action_id]: "" }));
    try {
      if (kind === "approve") {
        await approveAction(action.action_id);
        setResolved((r) => ({ ...r, [action.action_id]: "approved" }));
        onResolved?.(action.action_id, "approved");
      } else {
        await rejectAction(action.action_id);
        setResolved((r) => ({ ...r, [action.action_id]: "rejected" }));
        onResolved?.(action.action_id, "rejected");
      }
    } catch {
      setErrors((e) => ({ ...e, [action.action_id]: "Action failed — GitHub call did not complete." }));
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-info" strokeWidth={2.25} />
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink">Agent Recommends</h3>
      </div>

      <ul className="flex flex-col gap-3">
        {actions.map((action) => {
          const status = resolved[action.action_id];
          const isBusy = busy === action.action_id;
          return (
            <li key={action.action_id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{describeAction(action)}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {action.reason} · {Math.round(action.confidence * 100)}% confidence
                  </p>
                </div>
                {status === "approved" && (
                  <span className="flex flex-none items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-xs font-bold text-success animate-count-up">
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Applied
                  </span>
                )}
                {status === "rejected" && (
                  <span className="flex flex-none items-center gap-1 rounded-full bg-danger-soft px-2 py-1 text-xs font-bold text-danger animate-count-up">
                    <XCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Rejected
                  </span>
                )}
              </div>
              {errors[action.action_id] && (
                <p className="mt-2 text-xs font-semibold text-danger">{errors[action.action_id]}</p>
              )}
              {!status && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handle(action, "approve")}
                    disabled={isBusy}
                    className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                  >
                    {isBusy ? "Sending…" : "Approve & Post"}
                  </button>
                  <button
                    onClick={() => handle(action, "reject")}
                    disabled={isBusy}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted transition-colors hover:text-ink disabled:opacity-60"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] text-muted">
        {pending.length === 0
          ? "Every GitHub-facing action required explicit maintainer approval before it ran."
          : "Every GitHub-facing action requires explicit maintainer approval before it runs."}
      </p>
    </div>
  );
}
