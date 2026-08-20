import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRepo } from "../lib/RepoContext";
import { loadInvestigationsWithDetail } from "../lib/adapters";
import type { Investigation } from "../lib/seed";

export function DuplicateIntelligence() {
  const navigate = useNavigate();
  const { repoName } = useRepo();
  const [investigations, setInvestigations] = useState<Investigation[] | null>(null);

  useEffect(() => {
    loadInvestigationsWithDetail(repoName)
      .then(setInvestigations)
      .catch(() => setInvestigations([]));
  }, [repoName]);

  const duplicates = (investigations ?? []).filter((i) => i.decision === "duplicate");
  const total = investigations?.length ?? 0;
  const rate = total > 0 ? Math.round((duplicates.length / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Duplicate Intelligence</h1>
        <p className="text-sm text-muted">Semantic duplicate detection across {repoName}'s issue backlog.</p>
      </div>

      <div className="rounded-2xl border border-border bg-ink p-8 text-white shadow-flat">
        <p className="font-mono text-5xl font-extrabold">{rate}%</p>
        <p className="mt-2 text-sm text-white/70">
          of investigated issues on {repoName} were classified as duplicate or already-resolved reports.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">Duplicate Decisions</h2>
        {investigations === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : duplicates.length === 0 ? (
          <p className="text-sm text-muted">No duplicates detected yet — run more investigations to build history.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {duplicates.map((inv) => (
              <button
                key={inv.id}
                onClick={() => navigate(`/issue/${inv.id}`)}
                className="flex items-center justify-between rounded-xl border border-border bg-card p-4 text-left shadow-flat-sm transition-transform hover:-translate-y-0.5"
              >
                <div>
                  <p className="font-mono text-xs text-muted">#{inv.number}</p>
                  <p className="text-sm font-bold text-ink">{inv.title}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
