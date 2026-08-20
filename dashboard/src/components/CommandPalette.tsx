import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { DecisionBadge } from "./DecisionBadge";
import { EvidenceChip } from "./EvidenceChip";
import { useRepo } from "../lib/RepoContext";
import { loadInvestigationsWithDetail } from "../lib/adapters";
import type { Investigation } from "../lib/seed";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const SUGGESTIONS = [
  "What should I care about?",
  "What's changed recently?",
  "Show escalated issues.",
  "Show duplicates.",
];

interface Answer {
  answer: string;
  confidence: number;
  evidence: Investigation["evidence"];
  nextAction: string;
}

function groundedAnswer(query: string, investigations: Investigation[]): Answer {
  const q = query.toLowerCase();
  const numberMatch = q.match(/#?(\d+)/);
  if (numberMatch) {
    const match = investigations.find((inv) => inv.number === parseInt(numberMatch[1], 10));
    if (match) {
      return {
        answer: match.reason || `Decision: ${match.decision}.`,
        confidence: match.confidence,
        evidence: match.evidence.slice(0, 3),
        nextAction: match.needsAttention ? "Open the investigation for full evidence." : "No action needed.",
      };
    }
    return {
      answer: `No investigation found for #${numberMatch[1]} yet. Run one from Command Center.`,
      confidence: 0,
      evidence: [],
      nextAction: "Go to Command Center and enter the issue number.",
    };
  }
  if (q.includes("care about") || q.includes("attention")) {
    const attn = investigations.filter((i) => i.needsAttention);
    return {
      answer:
        attn.length === 0
          ? "Nothing needs attention right now."
          : `${attn.length} things need you right now: ${attn.map((i) => `#${i.number}`).join(", ")}.`,
      confidence: 0.9,
      evidence: attn.flatMap((i) => i.evidence.slice(0, 1)),
      nextAction: "Open Command Center to review the queue.",
    };
  }
  if (q.includes("duplicate")) {
    const dups = investigations.filter((i) => i.decision === "duplicate");
    return {
      answer:
        dups.length === 0
          ? "No duplicates detected yet."
          : `${dups.length} issue(s) closed as duplicates: ${dups.map((i) => `#${i.number}`).join(", ")}.`,
      confidence: 0.85,
      evidence: [],
      nextAction: "Open Duplicate Intelligence for the full cluster view.",
    };
  }
  if (q.includes("escalat")) {
    const esc = investigations.filter((i) => i.decision === "escalate");
    return {
      answer:
        esc.length === 0
          ? "No escalations right now."
          : `${esc.length} escalated: ${esc.map((i) => `#${i.number}`).join(", ")}.`,
      confidence: 0.9,
      evidence: [],
      nextAction: "Open the Attention queue.",
    };
  }
  return {
    answer: "I don't have enough grounded evidence in project memory to answer that precisely.",
    confidence: 0.3,
    evidence: [],
    nextAction: "Try asking about a specific issue number, or 'what needs attention'.",
  };
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { repoName } = useRepo();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResult(null);
      loadInvestigationsWithDetail(repoName)
        .then(setInvestigations)
        .catch(() => setInvestigations([]));
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, repoName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function ask(q: string) {
    setQuery(q);
    setResult(groundedAnswer(q, investigations));
  }

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
          <Search className="h-4 w-4 text-muted" strokeWidth={2.25} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(query)}
            placeholder={`Ask RepoGuardian about ${repoName}...`}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </div>

        <div className="max-h-96 overflow-y-auto p-4">
          {result ? (
            <div className="animate-rise-in flex flex-col gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Answer</p>
              <p className="text-sm text-ink">{result.answer}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">Confidence</span>
                <DecisionBadge decision="escalate" size="sm" confidence={result.confidence} />
              </div>
              {result.evidence.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Evidence</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.evidence.map((ev, i) => (
                      <EvidenceChip key={i} evidence={ev} />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Next Action</p>
                <p className="text-sm text-ink/80">{result.nextAction}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Suggested questions</p>
              {SUGGESTIONS.map((s, i) => (
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
