import { TriangleAlert, ShieldCheck, HelpCircle, Copy, MessageCircleQuestion } from "lucide-react";
import type { Decision } from "../lib/seed";

export interface DecisionBadgeProps {
  decision: Decision;
  confidence?: number;
  size?: "sm" | "md" | "lg";
  layout?: "inline" | "stacked";
}

// Soft background + solid-color text/icon, matching every other status chip
// in the app (ActionApproval, AgentRunTimeline, TopBar's connection state,
// Sidebar's nav counts) — a flat saturated fill was the one place this
// pattern was broken, which is what read as generic/off-brand.
const DECISION_META: Record<
  Decision,
  { label: string; bg: string; fg: string; border: string; icon: typeof TriangleAlert; iconAnim: string }
> = {
  escalate: {
    label: "Escalate",
    bg: "bg-danger-soft",
    fg: "text-danger",
    border: "border-danger/30",
    icon: TriangleAlert,
    iconAnim: "animate-badge-alert",
  },
  silent: {
    label: "Stay Silent",
    bg: "bg-success-soft",
    fg: "text-success",
    border: "border-success/30",
    icon: ShieldCheck,
    iconAnim: "animate-badge-check",
  },
  followup: {
    label: "Needs Information",
    bg: "bg-warning-soft",
    fg: "text-warning",
    border: "border-warning/30",
    icon: MessageCircleQuestion,
    iconAnim: "animate-badge-bob",
  },
  duplicate: {
    label: "Duplicate",
    bg: "bg-info-soft",
    fg: "text-info",
    border: "border-info/30",
    icon: Copy,
    iconAnim: "animate-badge-spin-in",
  },
  insufficient: {
    label: "Insufficient Evidence",
    bg: "bg-background",
    fg: "text-muted",
    border: "border-border",
    icon: HelpCircle,
    iconAnim: "",
  },
};

const SIZE_CLASS = {
  sm: "px-2 py-0.5 text-[11px] gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
  lg: "px-3 py-1.5 text-sm gap-2",
};

export function DecisionBadge({ decision, confidence, size = "md", layout = "inline" }: DecisionBadgeProps) {
  const { label, bg, fg, border, icon: Icon, iconAnim } = DECISION_META[decision];

  if (layout === "stacked") {
    return (
      <div className={`flex flex-col items-end gap-1.5 rounded-lg border ${border} ${bg} px-3 py-2`}>
        <span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${fg}`}>
          <Icon className={`h-3.5 w-3.5 ${iconAnim}`} strokeWidth={2.25} />
          {label}
        </span>
        {confidence !== undefined && (
          <span className={`flex items-baseline gap-1 border-t ${border} pt-1.5 font-mono text-ink`}>
            <span className="text-base font-bold leading-none">{Math.round(confidence * 100)}</span>
            <span className="text-[10px] font-semibold text-muted">% confidence</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-md border ${border} font-bold uppercase tracking-wide ${bg} ${fg} ${SIZE_CLASS[size]}`}
    >
      <Icon className={`${size === "lg" ? "h-4 w-4" : "h-3 w-3"} ${iconAnim}`} strokeWidth={2.25} />
      {label}
      {confidence !== undefined && (
        <span className="font-mono opacity-70">· {Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}
