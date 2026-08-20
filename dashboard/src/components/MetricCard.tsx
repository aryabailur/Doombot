import { useRef, type MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";

export interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "good" | "bad" | "neutral";
  icon?: LucideIcon;
  accent?: boolean;
  meaning?: string;
  style?: React.CSSProperties;
}

export function MetricCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  icon: Icon,
  accent,
  meaning,
  style,
}: MetricCardProps) {
  const deltaColor =
    deltaTone === "good" ? "text-success" : deltaTone === "bad" ? "text-danger" : "text-muted";
  const ref = useRef<HTMLDivElement>(null);

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      style={style}
      className={`card-lift magnetic-glow animate-stagger-in relative flex flex-col justify-between gap-2 overflow-hidden rounded-2xl border border-border p-5 shadow-flat-sm ${
        accent ? "bg-ink text-white" : "bg-card text-ink"
      }`}
    >
      <div className="relative z-10 flex items-center justify-between">
        <span className={`text-xs font-bold uppercase tracking-wide ${accent ? "text-white/70" : "text-muted"}`}>
          {label}
        </span>
        {Icon && <Icon className={`h-4 w-4 ${accent ? "text-accent" : "text-muted"}`} strokeWidth={2.25} />}
      </div>
      <div className="relative z-10 flex items-end gap-2">
        <span className="font-mono text-3xl font-extrabold leading-none">{value}</span>
        {delta && <span className={`mb-0.5 text-xs font-bold ${accent ? "text-accent" : deltaColor}`}>{delta}</span>}
      </div>
      {meaning && (
        <p className={`relative z-10 text-xs ${accent ? "text-white/60" : "text-muted"}`}>{meaning}</p>
      )}
    </div>
  );
}
