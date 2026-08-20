import { useEffect, useState } from "react";
import { CircleDot, FileText, Search } from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import { loadInvestigationsWithDetail } from "../lib/adapters";
import { queryMemory, ApiError } from "../lib/api";
import type { Investigation } from "../lib/seed";
import type { MemoryQueryResult } from "../lib/types";

type SearchState = "idle" | "loading" | "done" | "error";

export function ProjectMemory() {
  const { owner, repo, repoName } = useRepo();
  const [investigations, setInvestigations] = useState<Investigation[] | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryQueryResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState<string | null>(null);

  useEffect(() => {
    loadInvestigationsWithDetail(repoName)
      .then(setInvestigations)
      .catch(() => setInvestigations([]));
  }, [repoName]);

  const total = investigations?.length ?? 0;
  const withEvidence = (investigations ?? []).filter((i) => i.evidence.length > 0).length;

  const runSearch = () => {
    const trimmed = query.trim();
    if (!trimmed || !owner || !repo) return;

    setSearchState("loading");
    setErrorMessage(null);

    queryMemory(owner, repo, trimmed)
      .then((res) => {
        setResults(res.results);
        setSearchedFor(res.query);
        setSearchState("done");
      })
      .catch((err: unknown) => {
        setResults([]);
        setSearchedFor(trimmed);
        setErrorMessage(
          err instanceof ApiError
            ? `Search failed (${err.status}). Try again in a moment.`
            : "Could not reach the memory index. Check your connection and try again."
        );
        setSearchState("error");
      });
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Project Memory</h1>
        <p className="text-sm text-muted">What RepoGuardian has retrieved about {repoName} so far.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-ink p-5 text-white shadow-flat-sm">
          <p className="font-mono text-2xl font-extrabold">{total}</p>
          <p className="text-xs text-white/60">investigations run</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-flat-sm">
          <p className="font-mono text-2xl font-extrabold text-ink">{withEvidence}</p>
          <p className="text-xs text-muted">with retrieved evidence</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Search the memory index</h2>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted" strokeWidth={2.25} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder={`Search issues and files indexed for ${repoName}...`}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
          <button
            onClick={runSearch}
            disabled={!query.trim() || searchState === "loading"}
            className="shrink-0 rounded-lg border border-ink bg-ink px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {searchState === "loading" ? "Searching…" : "Search"}
          </button>
        </div>

        <div className="mt-5">
          {searchState === "idle" && (
            <p className="text-sm text-muted">Enter a query to search indexed issues and files by semantic similarity.</p>
          )}

          {searchState === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2 w-2 animate-pulse-dot rounded-full bg-info" />
              Searching the vector store for "{query.trim()}"…
            </div>
          )}

          {searchState === "error" && errorMessage && (
            <div className="rounded-xl border border-border bg-danger-soft px-4 py-3 text-sm text-ink">{errorMessage}</div>
          )}

          {searchState === "done" && results.length === 0 && (
            <p className="text-sm text-muted">No matches for "{searchedFor}". Try a broader or different query.</p>
          )}

          {searchState === "done" && results.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted">
                {results.length} result{results.length === 1 ? "" : "s"} for "{searchedFor}"
              </p>
              {results.map((r, idx) => {
                const Icon = r.type === "file" ? FileText : CircleDot;
                const pct = Math.round(r.score * 100);
                const card = (
                  <div
                    className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-flat-sm transition-colors hover:border-ink animate-rise-in"
                    style={{ animationDelay: `${Math.min(idx, 8) * 40}ms`, animationFillMode: "backwards" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-muted">
                          <Icon className="h-3 w-3" strokeWidth={2.25} />
                          {r.type}
                        </span>
                        {r.number !== null && <span className="font-mono text-xs text-muted">#{r.number}</span>}
                      </div>
                      <span className="font-mono text-xs font-bold text-ink">{pct}%</span>
                    </div>
                    <p className="font-bold text-ink">{r.title}</p>
                    <p className="text-sm text-muted">{r.reason}</p>
                  </div>
                );

                return r.url ? (
                  <a key={r.item_id} href={r.url} target="_blank" rel="noreferrer" className="block">
                    {card}
                  </a>
                ) : (
                  <div key={r.item_id}>{card}</div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-lilac p-6 shadow-flat-sm">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink">About this page</h2>
        <p className="text-sm text-ink/80">
          Search above queries the {repoName} vector store directly — the same ChromaDB index of issues and code
          files the triage agent uses to find duplicates and relevant context. The summary cards show how memory
          was used across past investigations; open an individual investigation to see its actual retrieved
          evidence and similarity scores.
        </p>
      </div>
    </div>
  );
}
