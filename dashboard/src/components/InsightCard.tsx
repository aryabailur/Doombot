import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { EvidenceRef } from "../lib/seed";
import { EvidenceChip } from "./EvidenceChip";

export interface InsightCardProps {
  title?: string;
  copy: string;
  evidence?: EvidenceRef[];
  confidence?: number;
}

function useTypewriter(text: string, speed = 14) {
  const [shown, setShown] = useState("");

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      setShown(text);
      return;
    }

    setShown("");
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  return shown;
}

export function InsightCard({ title = "Agent Interpretation", copy, evidence, confidence }: InsightCardProps) {
  const shown = useTypewriter(copy);
  const done = shown.length === copy.length;

  return (
    <div className="card-lift relative overflow-hidden rounded-2xl border border-border bg-lilac p-6 shadow-flat-sm">
      <div
        className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full opacity-30 blur-2xl"
        style={{ background: "radial-gradient(circle, var(--info), transparent 70%)" }}
      />
      <div className="relative z-10 mb-2 flex items-center gap-2">
        <Sparkles
          className={`h-4 w-4 text-info ${!done ? "animate-pulse-dot" : ""}`}
          strokeWidth={2.25}
        />
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink">{title}</h3>
        {confidence !== undefined && (
          <span className="ml-auto font-mono text-xs font-semibold text-muted">
            Forecast confidence: {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
      <p className="relative z-10 text-[15px] leading-relaxed text-ink">
        {shown}
        {!done && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse-dot bg-info align-middle" />}
      </p>
      {evidence && evidence.length > 0 && done && (
        <div className="relative z-10 mt-3 flex flex-wrap gap-1.5">
          {evidence.map((ev, i) => (
            <span key={ev.id} className="animate-stagger-in" style={{ "--stagger-i": i } as React.CSSProperties}>
              <EvidenceChip evidence={ev} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
