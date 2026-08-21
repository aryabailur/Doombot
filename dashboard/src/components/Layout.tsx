import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { AskRepoGuardian } from "./AskRepoGuardian";
import { useSocket } from "../lib/useSocket";

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";

export function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askInitialQuery, setAskInitialQuery] = useState<string | undefined>(undefined);
  const { connectionState } = useSocket({ url: WS_URL, onEvent: () => {} });
  const location = useLocation();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAskInitialQuery(undefined);
        setAskOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Repository Architecture's node detail panel dispatches this event
  // (loosely coupled — see CodeGraph.tsx) instead of importing AskRepoGuardian
  // directly, so a click on "Ask RepoGuardian" for a graph node opens the
  // same global assistant, pre-scoped to that node's real context.
  useEffect(() => {
    function onAsk(e: Event) {
      const detail = (e as CustomEvent<{ context?: string }>).detail;
      setAskInitialQuery(detail?.context ?? undefined);
      setAskOpen(true);
    }
    window.addEventListener("repoguardian:ask", onAsk);
    return () => window.removeEventListener("repoguardian:ask", onAsk);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenAsk={() => setAskOpen(true)}
          connectionState={connectionState}
        />
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <div key={location.pathname} className="animate-page-in mx-auto max-w-[1500px]">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AskRepoGuardian
        open={askOpen}
        onClose={() => setAskOpen(false)}
        initialQuery={askInitialQuery}
      />
    </div>
  );
}
