import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import { listActions } from "../lib/api";
import type { SuggestedActionApi } from "../lib/types";
import { ActionApproval } from "../components/ActionApproval";

export function ApprovalCenter() {
  const { repoName } = useRepo();
  const navigate = useNavigate();
  const [actions, setActions] = useState<SuggestedActionApi[] | null>(null);

  const load = useCallback(() => {
    listActions(repoName, "pending")
      .then(setActions)
      .catch(() => setActions([]));
  }, [repoName]);

  useEffect(() => {
    setActions(null);
    load();
  }, [load]);

  const byInvestigation = new Map<string, SuggestedActionApi[]>();
  for (const action of actions ?? []) {
    const list = byInvestigation.get(action.investigation_id) ?? [];
    list.push(action);
    byInvestigation.set(action.investigation_id, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Approval Center</h1>
        <p className="text-sm text-muted">
          Below-threshold labels and comments for {repoName}, waiting on a maintainer before they
          reach GitHub.
        </p>
      </div>

      {actions === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : byInvestigation.size === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-10 text-center shadow-flat-sm">
          <ShieldCheck className="h-8 w-8 text-success" strokeWidth={2} />
          <p className="text-sm font-semibold text-ink">Nothing waiting on you.</p>
          <p className="max-w-sm text-xs text-muted">
            High-confidence actions (≥85%) are applied automatically. Anything below that
            threshold shows up here for review.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Array.from(byInvestigation.entries()).map(([investigationId, group]) => (
            <div key={investigationId} className="flex flex-col gap-2">
              <button
                onClick={() => navigate(`/issue/${investigationId}`)}
                className="w-fit text-left text-xs font-bold uppercase tracking-wide text-info hover:underline"
              >
                #{group[0].number} — view investigation
              </button>
              <ActionApproval actions={group} onResolved={() => load()} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
