import type { ReactNode } from "react";
import { Skull } from "lucide-react";
import type { ConnectionState } from "../lib/useSocket";
import { AgentStatusIndicator } from "./AgentStatusIndicator";

export interface AppShellProps {
  connectionState: ConnectionState;
  children: ReactNode;
}

export function AppShell({ connectionState, children }: AppShellProps) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b-4 border-border bg-surface-1">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-accent shadow-brutal-sm">
              <Skull className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="font-display text-xl font-extrabold leading-none tracking-tight">
                DOOMBOT
              </h1>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
                Maintainer Agent
              </p>
            </div>
          </div>
          <AgentStatusIndicator connectionState={connectionState} />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
