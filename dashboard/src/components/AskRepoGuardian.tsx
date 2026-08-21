import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Search, Network, Scale } from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import { askRepoGuardian } from "../lib/api";
import type { AskResponse } from "../lib/types";
import { VisualBlock, CitationRow, confidenceBand, ACTION_LABEL } from "./AskVisuals";

export interface AskRepoGuardianProps {
  open: boolean;
  onClose: () => void;
  investigationId?: string;
  contextLabel?: string;
  initialQuery?: string;
}

const GLOBAL_SUGGESTIONS = [
  "What needs my attention right now?",
  "Show recent security signals.",
  "What duplicates were found this week?",
  "What does the maintainer precedent look like?",
];

const SCOPED_SUGGESTIONS = [
  "Why was this escalated?",
  "Show supporting evidence",
  "Find similar incidents",
  "Show maintainer precedent",
];

export function AskRepoGuardian({
  open,
  onClose,
  investigationId,
  contextLabel,
  initialQuery,
}: AskRepoGuardianProps) {
  const { repoName } = useRepo();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setErrorMsg(null);
      if (initialQuery) {
        setQuery(initialQuery);
        ask(initialQuery);
      } else {
        setQuery("");
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setQuery(q);
    setLoading(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const res = await askRepoGuardian({
        repo_name: repoName,
        question: q,
        ...(investigationId ? { investigation_id: investigationId } : {}),
      });
      setResult(res);
    } catch {
      setErrorMsg("RepoGuardian couldn't answer that right now — check the API connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function runAction(action: string) {
    if (action === "open_investigation" && investigationId) {
      onClose();
      navigate(`/issue/${investigationId}`);
    } else if (action === "view_architecture") {
      onClose();
      navigate("/code-graph");
    }
  }

  const suggestions = investigationId ? SCOPED_SUGGESTIONS : GLOBAL_SUGGESTIONS;
  const placeholder = contextLabel
    ? `Ask RepoGuardian about ${contextLabel}...`
    : `Ask RepoGuardian why, about ${repoName}...`;

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-start justify-center bg-ink/40 pt-24 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-modal-pop-in w-full max-w-xl rounded-2xl border border-border bg-card shadow-flat-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-muted" strokeWidth={2.25} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(query)}
            placeholder={placeholder}
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted disabled:opacity-60"
          />
          <button
            onClick={() => ask(query)}
            disabled={loading || !query.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={2.25} />
            Ask
          </button>
        </div>

        <div className="max-h-[28rem] overflow-y-auto p-4">
          {loading && (
            <div className="flex flex-col gap-3">
              <div className="skeleton-block h-4 w-3/4" />
              <div className="skeleton-block h-4 w-1/2" />
              <div className="skeleton-block h-24 w-full rounded-xl" />
            </div>
          )}

          {!loading && errorMsg && <p className="text-sm text-danger">{errorMsg}</p>}

          {!loading && !errorMsg && result && (
            <div className="flex flex-col gap-4">
              <p className="animate-rise-in text-sm leading-relaxed text-ink">{result.answer}</p>

              {result.insufficient_evidence ? null : (
                <>
                  {result.visuals.length > 0 && (
                    <div className="flex flex-col gap-3">
                      {result.visuals.map((visual, i) => (
                        <VisualBlock key={`${visual.kind}-${i}`} visual={visual} index={i} />
                      ))}
                    </div>
                  )}

                  {result.citations.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Citations</p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.citations.map((citation, i) => (
                          <CitationRow key={`${citation.type}-${citation.ref}-${i}`} citation={citation} index={i} />
                        ))}
                      </div>
                    </div>
                  )}

                  {result.confidence !== null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Confidence</span>
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2.5 py-1 text-xs font-bold text-ink">
                        <Scale className="h-3.5 w-3.5 text-muted" strokeWidth={2.25} />
                        {confidenceBand(result.confidence)} · {Math.round(result.confidence * 100)}%
                      </span>
                    </div>
                  )}

                  {result.suggested_actions.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                      {result.suggested_actions.map((action) => {
                        const clickable =
                          (action === "open_investigation" && !!investigationId) || action === "view_architecture";
                        return (
                          <button
                            key={action}
                            onClick={() => clickable && runAction(action)}
                            disabled={!clickable}
                            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors enabled:hover:border-ink enabled:hover:text-ink disabled:opacity-40"
                          >
                            {action === "view_architecture" && <Network className="h-3.5 w-3.5" strokeWidth={2.25} />}
                            {ACTION_LABEL[action] ?? action}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {!loading && !errorMsg && !result && (
            <div className="flex flex-col gap-1.5">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Suggested questions</p>
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="animate-stagger-in rounded-lg px-2.5 py-2 text-left text-sm text-ink/80 transition-all duration-150 hover:translate-x-1 hover:bg-background"
                  style={{ "--stagger-i": i } as React.CSSProperties}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
