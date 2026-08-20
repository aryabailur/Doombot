import { useEffect, useState } from "react";
import { useRepo } from "../lib/RepoContext";
import { getBrief } from "../lib/api";
import type { BriefResponseApi } from "../lib/types";

export function WeeklyBrief() {
  const { owner, repo, repoName } = useRepo();
  const [brief, setBrief] = useState<BriefResponseApi | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo) return;
    getBrief(owner, repo)
      .then(setBrief)
      .catch(() => setError("Could not load the brief for this repository."));
  }, [owner, repo]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!brief) return <p className="text-sm text-muted">Loading brief…</p>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted">{repoName}</p>
        <h1 className="mt-1 text-3xl font-extrabold text-ink">Your Week With RepoGuardian</h1>
        <p className="mt-1 text-xs text-muted">Generated {new Date(brief.generated_at).toLocaleString()}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{brief.markdown}</pre>
      </div>

      <p className="text-center text-sm italic text-muted">
        "RepoGuardian doesn't replace the maintainer. It protects the maintainer's attention."
      </p>
    </div>
  );
}
