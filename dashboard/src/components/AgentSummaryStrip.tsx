import { ArrowRight, Activity, Search, Telescope, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AnimatedNumber } from "./AnimatedNumber";

export interface AgentSummaryStripProps {
  investigatedCount: number;
  handledCount: number;
  surfacedCount: number;
  lastScanAt: string | null;
  isWorking?: boolean;
}

const STAGES = [
  { key: "monitored", label: "Monitored", detail: "Repo activity", icon: Activity },
  { key: "investigated", label: "Investigated", detail: null, icon: Search },
  { key: "analyzed", label: "Analyzed", detail: "Signals & context", icon: Telescope },
  { key: "surfaced", label: "Surfaced", detail: null, icon: Sparkles },
] as const;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Stagger step between each stage lighting up — the connecting line fills
// first, then the node it leads into "charges", then the next line starts.
const FLOW_STEP_MS = 260;

export function AgentSummaryStrip({
  investigatedCount,
  handledCount,
  surfacedCount,
  lastScanAt,
  isWorking,
}: AgentSummaryStripProps) {
  const navigate = useNavigate();

  const stageDetail: Record<string, string> = {
    investigated: `${investigatedCount} issue${investigatedCount === 1 ? "" : "s"}`,
    surfaced: `${surfacedCount} for review`,
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-ink text-white shadow-flat ${
        isWorking ? "animate-live-border" : ""
      }`}
    >
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-[0.12] blur-3xl"
        style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }}
      />
      <div className="relative z-10 grid grid-cols-1 divide-y divide-white/10 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:divide-x lg:divide-y-0">
        <div className="flex flex-col justify-center gap-1.5 px-6 py-5">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent">
            {isWorking && <Sparkles className="h-3 w-3 animate-pulse-dot" strokeWidth={2.5} />}
            Agent Summary
          </span>
          <p className="font-mono text-4xl font-extrabold leading-none">
            <AnimatedNumber value={investigatedCount} />
            <span className="ml-2.5 align-middle text-sm font-semibold text-white/60">
              investigation{investigatedCount === 1 ? "" : "s"} run
            </span>
          </p>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-white/50">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <AnimatedNumber value={handledCount} /> handled automatically
          </p>
        </div>

        <div className="flex flex-col justify-center gap-2 px-6 py-5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">What the agent did</span>
          <div className="flex items-center gap-1">
            {STAGES.map((stage, i) => (
              <div key={stage.key} className="flex items-center">
                {i > 0 && (
                  <span className="relative mx-2 flex h-3.5 w-6 flex-none items-center overflow-hidden">
                    <span className="absolute inset-y-1/2 left-0 h-px w-full bg-white/15" />
                    <span
                      className="animate-flow-line absolute inset-y-1/2 left-0 h-px w-full bg-accent"
                      style={{ "--flow-delay": `${(i - 1) * 2 * FLOW_STEP_MS + FLOW_STEP_MS}ms` } as React.CSSProperties}
                    />
                    <ArrowRight
                      className="relative z-10 mx-auto h-3.5 w-3.5 text-white/40"
                      strokeWidth={2}
                    />
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span
                    className="animate-flow-node flex h-7 w-7 flex-none items-center justify-center rounded-full border border-white/15 bg-white/5"
                    style={{ "--flow-delay": `${i * 2 * FLOW_STEP_MS}ms` } as React.CSSProperties}
                  >
                    <stage.icon className="h-3.5 w-3.5 text-accent" strokeWidth={2.25} />
                  </span>
                  <div
                    className="animate-flow-label flex flex-col leading-tight"
                    style={{ "--flow-delay": `${i * 2 * FLOW_STEP_MS}ms` } as React.CSSProperties}
                  >
                    <span className="text-xs font-bold">{stage.label}</span>
                    <span className="font-mono text-[10px] text-white/50">
                      {stageDetail[stage.key] ?? stage.detail}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-start justify-center gap-2 px-6 py-5 lg:items-end">
          <button
            onClick={() => navigate("/attention")}
            className="group inline-flex items-center gap-2 overflow-hidden rounded-lg bg-accent px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition-all duration-300 hover:-translate-y-0.5 hover:gap-3 hover:shadow-flat-sm"
          >
            Review Attention ({surfacedCount})
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2.5} />
          </button>
          {lastScanAt && (
            <span className="font-mono text-[11px] text-white/40">Last scan {relativeTime(lastScanAt)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
