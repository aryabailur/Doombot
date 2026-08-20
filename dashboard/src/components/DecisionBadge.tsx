import { TriangleAlert, ShieldCheck, HelpCircle, Copy, MessageCircleQuestion } from "lucide-react";
import type { Decision } from "../lib/seed";

export interface DecisionBadgeProps {
  decision: Decision;
  confidence?: number;
  size?: "sm" | "md" | "lg";
  layout?: "inline" | "stacked";
}

const DECISION_META: Record<
  Decision,
  { label: string; bg: string; fg: string; icon: typeof TriangleAlert; iconAnim: string }
> = {
  escalate: { label: "Escalate", bg: "bg-danger", fg: "text-white", icon: TriangleAlert, iconAnim: "animate-badge-alert" },
  silent: { label: "Stay Silent", bg: "bg-success", fg: "text-white", icon: ShieldCheck, iconAnim: "animate-badge-check" },
  followup: { label: "Needs Information", bg: "bg-warning", fg: "text-ink", icon: MessageCircleQuestion, iconAnim: "animate-badge-bob" },
  duplicate: { label: "Duplicate", bg: "bg-info", fg: "text-white", icon: Copy, iconAnim: "animate-badge-spin-in" },
  insufficient: { label: "Insufficient Evidence", bg: "bg-muted", fg: "text-white", icon: HelpCircle, iconAnim: "" },
};

const SIZE_CLASS = {
  sm: "px-2 py-0.5 text-[11px] gap-1",
  md: "px-3 py-1 text-xs gap-1.5",
  lg: "px-4 py-1.5 text-sm gap-2",
};

export function DecisionBadge({ decision, confidence, size = "md", layout = "inline" }: DecisionBadgeProps) {
  const { label, bg, fg, icon: Icon, iconAnim } = DECISION_META[decision];

  if (layout === "stacked") {
    return (
      <div
        className={`card-lift flex flex-col items-end gap-0.5 rounded-lg px-3 py-1.5 ${bg} ${fg}`}
      >
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest opacity-90">
          <Icon className={`h-3 w-3 ${iconAnim}`} strokeWidth={2.5} />
          {label}
        </span>
        {confidence !== undefined && (
          <span className="font-mono text-xl font-extrabold leading-none">
            {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
    );
  }

  return (
    <span
      className={`card-lift inline-flex items-center rounded-md font-bold uppercase tracking-wide ${bg} ${fg} ${SIZE_CLASS[size]}`}
    >
      <Icon className={`${size === "lg" ? "h-4 w-4" : "h-3 w-3"} ${iconAnim}`} strokeWidth={2.5} />
      {label}
      {confidence !== undefined && (
        <span className="opacity-80">· {Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}
