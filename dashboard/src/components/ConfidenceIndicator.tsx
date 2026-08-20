import { confidenceLabel } from "../lib/format";

export interface ConfidenceIndicatorProps {
  score: number | null;
}

const TONE_BG: Record<string, string> = {
  high: "bg-success text-white",
  medium: "bg-warning text-text-primary",
  low: "bg-neutral text-white",
};

export function ConfidenceIndicator({ score }: ConfidenceIndicatorProps) {
  const { label, tone } = confidenceLabel(score);
  return (
    <span
      className={`inline-flex items-center rounded-md border-2 border-border px-2.5 py-1 text-xs font-bold shadow-brutal-sm ${TONE_BG[tone]}`}
    >
      {label}
    </span>
  );
}
