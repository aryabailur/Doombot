import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Search, Network, Scale } from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import { askRepoGuardian } from "../lib/api";
import type { AskResponse } from "../lib/types";
import { VisualBlock, CitationRow, confidenceBand, ACTION_LABEL } from "../components/AskVisuals";

const SUGGESTIONS = [
  "What needs my attention right now?",
  "Show recent security signals.",
  "What duplicates were found this week?",
  "What does the maintainer precedent look like?",
];

interface Turn {
  question: string;
  result?: AskResponse;
  error?: string;
}

export function AskAI() {
  const { repoName } = useRepo();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setQuery("");
    setLoading(true);
    const turn: Turn = { question: q };
    setTurns((prev) => [...prev, turn]);
    try {
      const res = await askRepoGuardian({ repo_name: repoName, question: q });
      setTurns((prev) => prev.map((t) => (t === turn ? { ...t, result: res } : t)));
    } catch {
      setTurns((prev) =>
        prev.map((t) =>
          t === turn
            ? { ...t, error: "RepoGuardian couldn't answer that right now — check the API connection and try again." }
            : t
        )
      );
    } finally {
      setLoading(false);
    }
  }

  function runAction(action: string, investigationId?: string) {
    if (action === "open_investigation" && investigationId) {
      navigate(`/issue/${investigationId}`);
    } else if (action === "view_architecture") {
      navigate("/code-graph");
    }
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-ink">
          <Sparkles className="h-5 w-5 text-accent" strokeWidth={2.25} />
          Ask RepoGuardian
        </h1>
        <p className="mt-1 text-sm text-muted">
          Ask why, about {repoName} — every answer is grounded in real evidence from this
          repository's investigation history, never invented.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
        {turns.length === 0 && !loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft">
              <Sparkles className="h-5 w-5 text-accent" strokeWidth={2.25} />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Ask about anything in {repoName}</p>
              <p className="mt-1 text-xs text-muted">
                Escalations, duplicates, security findings, maintainer precedent — all backed by
                real evidence.
              </p>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="animate-stagger-in rounded-lg border border-border bg-background px-3 py-2 text-left text-sm text-ink/80 transition-all duration-150 hover:translate-x-1 hover:border-ink hover:text-ink"
                  style={{ "--stagger-i": i } as React.CSSProperties}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, ti) => (
          <div key={ti} className="flex flex-col gap-3">
            <div className="ml-auto max-w-lg rounded-xl rounded-tr-sm bg-ink px-4 py-2.5 text-sm font-medium text-white">
              {turn.question}
            </div>

            {!turn.result && !turn.error && (
              <div className="flex max-w-xl flex-col gap-3">
                <div className="skeleton-block h-4 w-3/4" />
                <div className="skeleton-block h-4 w-1/2" />
                <div className="skeleton-block h-20 w-full rounded-xl" />
              </div>
            )}

            {turn.error && <p className="text-sm text-danger">{turn.error}</p>}

            {turn.result && (
              <div className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-4">
                <p className="animate-rise-in text-sm leading-relaxed text-ink">{turn.result.answer}</p>

                {!turn.result.insufficient_evidence && (
                  <>
                    {turn.result.visuals.length > 0 && (
                      <div className="flex flex-col gap-3">
                        {turn.result.visuals.map((visual, i) => (
                          <VisualBlock key={`${visual.kind}-${i}`} visual={visual} index={i} />
                        ))}
                      </div>
                    )}

                    {turn.result.citations.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Citations</p>
                        <div className="flex flex-wrap gap-1.5">
                          {turn.result.citations.map((citation, i) => (
                            <CitationRow key={`${citation.type}-${citation.ref}-${i}`} citation={citation} index={i} />
                          ))}
                        </div>
                      </div>
                    )}

                    {turn.result.confidence !== null && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">Confidence</span>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1 text-xs font-bold text-ink">
                          <Scale className="h-3.5 w-3.5 text-muted" strokeWidth={2.25} />
                          {confidenceBand(turn.result.confidence)} · {Math.round(turn.result.confidence * 100)}%
                        </span>
                      </div>
                    )}

                    {turn.result.suggested_actions.length > 0 && (
                      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                        {turn.result.suggested_actions.map((action) => (
                          <button
                            key={action}
                            onClick={() => runAction(action)}
                            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-ink hover:text-ink"
                          >
                            {action === "view_architecture" && <Network className="h-3.5 w-3.5" strokeWidth={2.25} />}
                            {ACTION_LABEL[action] ?? action}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-flat-sm">
        <Search className="h-4 w-4 text-muted" strokeWidth={2.25} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(query)}
          placeholder={`Ask RepoGuardian why, about ${repoName}...`}
          disabled={loading}
          className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted disabled:opacity-60"
        />
        <button
          onClick={() => ask(query)}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
        >
          Ask
        </button>
      </div>
    </div>
  );
}
