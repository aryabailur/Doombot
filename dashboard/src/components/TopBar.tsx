import { useLocation } from "react-router-dom";
import { Command } from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import type { ConnectionState } from "../lib/useSocket";

export interface TopBarProps {
  onOpenPalette: () => void;
  connectionState: ConnectionState;
}

const CRUMB: Record<string, string> = {
  "/": "Command Center",
  "/attention": "Needs You",
  "/duplicates": "Duplicate Intelligence",
  "/security": "Security Signals",
  "/health": "Project Health",
  "/memory": "Project Memory",
  "/activity": "Agent Activity",
  "/decisions": "Decisions",
  "/approvals": "Approval Center",
  "/brief": "Weekly Brief",
};

const STATE_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  connected: "Agent Online",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

const STATE_BG: Record<ConnectionState, string> = {
  connecting: "bg-warning-soft text-warning",
  connected: "bg-success-soft text-success",
  reconnecting: "bg-warning-soft text-warning",
  offline: "bg-danger-soft text-danger",
};

export function TopBar({ onOpenPalette, connectionState }: TopBarProps) {
  const location = useLocation();
  const { repoName } = useRepo();
  const crumb = CRUMB[location.pathname] ?? "Investigation";

  return (
    <header className="flex h-16 flex-none items-center justify-between border-b border-border bg-card px-6">
      <p className="text-sm font-semibold text-muted">
        RepoGuardian <span className="mx-1 text-border">/</span>
        <span className="text-ink">{crumb}</span>
      </p>

      <div className={`flex items-center gap-2 rounded-full px-3 py-1 ${STATE_BG[connectionState]}`}>
        <span className="relative flex h-1.5 w-1.5">
          {connectionState === "connected" && (
            <span className="absolute inset-0 rounded-full bg-current animate-agent-pulse-ring" />
          )}
          <span
            className={`relative h-1.5 w-1.5 rounded-full bg-current ${connectionState === "connected" ? "animate-pulse-dot" : ""}`}
          />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wide">{STATE_LABEL[connectionState]}</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden font-mono text-xs text-muted sm:inline">{repoName}</span>
        <button
          onClick={onOpenPalette}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-ink hover:text-ink"
        >
          <Command className="h-3.5 w-3.5" strokeWidth={2.25} />
          <span className="font-mono">⌘ G</span>
        </button>
      </div>
    </header>
  );
}
