import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRepo } from "../lib/RepoContext";
import { loadInvestigationsWithDetail } from "../lib/adapters";
import type { Investigation, Decision } from "../lib/seed";
import { DecisionBadge } from "../components/DecisionBadge";

const FILTERS: (Decision | "all")[] = ["all", "escalate", "silent", "followup", "duplicate", "insufficient"];

const OUTCOME: Record<Decision, string> = {
  escalate: "Needs review",
  silent: "Resolved",
  followup: "Waiting",
  duplicate: "Merged mentally",
  insufficient: "Unresolved",
};

export function Decisions() {
  const navigate = useNavigate();
  const { repoName } = useRepo();
  const [rows, setRows] = useState<Investigation[] | null>(null);
  const [filter, setFilter] = useState<Decision | "all">("all");

  useEffect(() => {
    loadInvestigationsWithDetail(repoName)
      .then(setRows)
      .catch(() => setRows([]));
  }, [repoName]);

  const filtered = filter === "all" ? rows ?? [] : (rows ?? []).filter((r) => r.decision === filter);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Decisions</h1>
        <p className="text-sm text-muted">What has the agent actually decided on {repoName}?</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
              filter === f ? "border-ink bg-ink text-white" : "border-border bg-card text-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {rows === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">No investigations match this filter yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-flat-sm">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-bold uppercase tracking-wide text-muted">
                <th className="px-5 py-3">Issue</th>
                <th className="px-5 py-3">Decision</th>
                <th className="px-5 py-3">Evidence</th>
                <th className="px-5 py-3">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/issue/${inv.id}`)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-background"
                >
                  <td className="px-5 py-4">
                    <p className="font-mono text-xs text-muted">#{inv.number}</p>
                    <p className="font-bold text-ink">{inv.title}</p>
                  </td>
                  <td className="px-5 py-4">
                    <DecisionBadge decision={inv.decision} size="sm" />
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-muted">{inv.evidence.length} sources</td>
                  <td className="px-5 py-4 text-xs font-semibold text-ink/70">{OUTCOME[inv.decision]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
