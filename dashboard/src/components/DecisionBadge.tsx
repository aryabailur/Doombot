import { TriangleAlert, ShieldCheck, HelpCircle, Copy, MessageCircleQuestion } from "lucide-react";
import type { Decision } from "../lib/seed";

export interface DecisionBadgeProps {
  decision: Decision;
  confidence?: number;
  size?: "sm" | "md" | "lg";
}

const DECISION_META: Record<
  Decision,
  { label: string; bg: string; fg: string; icon: typeof TriangleAlert }
> = {
  escalate: { label: "Escalate", bg: "bg-danger", fg: "text-white", icon: TriangleAlert },
  silent: { label: "Stay Silent", bg: "bg-success", fg: "text-white", icon: ShieldCheck },
  followup: { label: "Needs Information", bg: "bg-warning", fg: "text-ink", icon: MessageCircleQuestion },
  duplicate: { label: "Duplicate", bg: "bg-info", fg: "text-white", icon: Copy },
  insufficient: { label: "Insufficient Evidence", bg: "bg-muted", fg: "text-white", icon: HelpCircle },
};

const SIZE_CLASS = {
  sm: "px-2 py-0.5 text-[11px] gap-1",
  md: "px-3 py-1 text-xs gap-1.5",
  lg: "px-4 py-1.5 text-sm gap-2",
};

export function DecisionBadge({ decision, confidence, size = "md" }: DecisionBadgeProps) {
  const { label, bg, fg, icon: Icon } = DECISION_META[decision];
  return (
    <span
      className={`inline-flex items-center rounded-md font-bold uppercase tracking-wide ${bg} ${fg} ${SIZE_CLASS[size]}`}
    >
      <Icon className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} strokeWidth={2.5} />
      {label}
      {confidence !== undefined && (
        <span className="opacity-80">· {Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}
