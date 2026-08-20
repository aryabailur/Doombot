import { useEffect, useState } from "react";
import { AttentionCard } from "../components/AttentionCard";
import { useRepo } from "../lib/RepoContext";
import { loadInvestigationsWithDetail } from "../lib/adapters";
import type { Investigation } from "../lib/seed";

export function AttentionQueue() {
  const { repoName } = useRepo();
  const [investigations, setInvestigations] = useState<Investigation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInvestigationsWithDetail(repoName)
      .then(setInvestigations)
      .catch(() => setError("Could not reach the API."));
  }, [repoName]);

  const attention = (investigations ?? []).filter((i) => i.needsAttention);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Requires Your Attention</h1>
        <p className="text-sm text-muted">Only what genuinely needs a maintainer's judgment reaches this list.</p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {investigations === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : attention.length === 0 ? (
        <p className="text-sm text-muted">Nothing needs attention right now.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {attention.map((inv, i) => (
            <AttentionCard key={inv.id} investigation={inv} style={{ "--stagger-i": i } as React.CSSProperties} />
          ))}
        </div>
      )}
    </div>
  );
}
