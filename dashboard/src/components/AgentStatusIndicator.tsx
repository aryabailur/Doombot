import { BrainCircuit } from "lucide-react";
import type { ConnectionState } from "../lib/useSocket";

export interface AgentStatusIndicatorProps {
  connectionState: ConnectionState;
}

const STATE_STYLE: Record<ConnectionState, { bg: string; label: string }> = {
  connecting: { bg: "bg-warning", label: "Connecting" },
  connected: { bg: "bg-success", label: "Live" },
  reconnecting: { bg: "bg-warning", label: "Reconnecting" },
  offline: { bg: "bg-critical", label: "Offline" },
};

export function AgentStatusIndicator({ connectionState }: AgentStatusIndicatorProps) {
  const { bg, label } = STATE_STYLE[connectionState];
  return (
    <div className="flex items-center gap-2 rounded-lg border-2 border-border bg-surface-1 px-3 py-1.5 shadow-brutal-sm">
      <BrainCircuit className="h-4 w-4 text-text-primary" strokeWidth={2.5} />
      <span
        className={`h-2 w-2 rounded-full border border-border ${bg} ${
          connectionState === "connected" ? "animate-pulse-dot" : ""
        }`}
        aria-hidden
      />
      <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
    </div>
  );
}
