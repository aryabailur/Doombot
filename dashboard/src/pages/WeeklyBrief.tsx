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

  if (!brief) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="skeleton-block h-8 w-40" />
        <div className="skeleton-block h-10 w-96" />
        <div className="skeleton-block h-48 w-full" />
      </div>
    );
  }

  const lines = brief.markdown.split("\n");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="animate-rise-in">
        <p className="text-xs font-bold uppercase tracking-widest text-muted">{repoName}</p>
        <h1 className="text-shimmer mt-1 text-3xl font-extrabold">Your Week With RepoGuardian</h1>
        <p className="mt-1 text-xs text-muted">Generated {new Date(brief.generated_at).toLocaleString()}</p>
      </div>

      <div className="card-lift rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
        <div className="flex flex-col gap-1 font-sans text-sm leading-relaxed text-ink">
          {lines.map((line, i) => (
            <p
              key={i}
              className={`animate-stagger-in whitespace-pre-wrap ${line.startsWith("#") ? "mt-2 font-extrabold" : ""} ${
                line.startsWith("-") ? "pl-2" : ""
              }`}
              style={{ "--stagger-i": Math.min(i, 12) } as React.CSSProperties}
            >
              {line.replace(/^#+\s*/, "")}
            </p>
          ))}
        </div>
      </div>

      <p className="animate-rise-in text-center text-sm italic text-muted" style={{ animationDelay: "300ms", animationFillMode: "backwards" }}>
        "RepoGuardian doesn't replace the maintainer. It protects the maintainer's attention."
      </p>
    </div>
  );
}
