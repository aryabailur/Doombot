import { TriangleAlert, ShieldAlert, Info } from "lucide-react";
import { severityTone } from "../lib/format";

export interface SeverityBadgeProps {
  severity: string;
}

const TONE_STYLES: Record<string, { bg: string; icon: typeof TriangleAlert }> = {
  critical: { bg: "bg-critical text-white", icon: ShieldAlert },
  high: { bg: "bg-high text-white", icon: TriangleAlert },
  warning: { bg: "bg-warning text-text-primary", icon: TriangleAlert },
  neutral: { bg: "bg-neutral text-white", icon: Info },
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const tone = severityTone(severity);
  const { bg, icon: Icon } = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border-2 border-border px-2.5 py-1 text-xs font-bold uppercase tracking-wide shadow-brutal-sm ${bg}`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={3} />
      {severity}
    </span>
  );
}
