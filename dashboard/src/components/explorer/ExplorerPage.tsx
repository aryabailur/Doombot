import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Code2, Loader2, LogOut, Network } from "lucide-react";

import { getCodeGraph, getIssueGraph } from "@/lib/api";
import type { CodeGraphResponse, IssueGraphResponse } from "@/lib/types";

import { Pill } from "./chrome";
import { ACCENT, PALETTE } from "./theme";

/**
 * Both explorers are lazily loaded.
 *
 * They are only reachable from this one route, and between them they pull in the
 * canvas renderers, the layout code, and the analysis passes. Loaded eagerly
 * they would sit in the entry bundle every other route waits on.
 */
const CodeExplorer = lazy(() =>
  import("./CodeExplorer").then((module) => ({ default: module.CodeExplorer }))
);
const IssueExplorer = lazy(() =>
  import("./IssueExplorer").then((module) => ({ default: module.IssueExplorer }))
);

type Source = "issues" | "code";

const THEME_KEY = "repoguardian.explorer.theme";

interface ExplorerPageProps {
  repoName: string;
}

/**
 * The graph explorer route: a full-bleed workspace over both graphs.
 *
 * Deliberately a thin shell. It owns the two fetches, the source switch, and the
 * theme, and nothing else — the two explorers under it are siblings, so a change
 * to one cannot break the other.
 *
 * It renders as `fixed inset-0` over the AppShell rather than inside the page
 * column, which is what makes the canvas full-bleed. "Exit" returns to Overview.
 *
 * The fetches are hand-rolled rather than going through `useApiData`, which is
 * otherwise the house hook. Two reasons, both load-bearing:
 *
 *   - `useApiData` fires its fetcher on mount. The code graph must not be
 *     requested until its tab is actually opened (see below), and the hook has
 *     no way to express "not yet".
 *   - It holds the fetcher in a ref, so a changed `repoName` cannot retrigger a
 *     load without a `refreshKey`. This page needs to *cancel* a stale response
 *     as well as start a new one, which is what `activeKey` below does.
 */
export function ExplorerPage({ repoName }: ExplorerPageProps) {
  const navigate = useNavigate();

  const [source, setSource] = useState<Source>("code");
  const [isDark, setIsDark] = useState(() => {
    try {
      return window.localStorage.getItem(THEME_KEY) !== "light";
    } catch {
      return true;
    }
  });

  const [issueGraph, setIssueGraph] = useState<IssueGraphResponse | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [codeGraph, setCodeGraph] = useState<CodeGraphResponse | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  /** Real state, not derived: "not fetched yet" and "fetching now" differ. */
  const [loadingCode, setLoadingCode] = useState(false);

  const [owner = "", repo = ""] = repoName.split("/");

  /**
   * Which repository the in-flight requests belong to.
   *
   * The code graph reads every source file over the network, which is long
   * enough for the reader to switch repositories mid-flight. Without this key
   * two things went wrong: the stale response populated the *previous*
   * repository's graph under the new name, and `loadingCode` stayed true so the
   * guard below blocked the new fetch permanently — the panel sat on "Reading
   * source…" for a request nobody was making.
   */
  const requestKey = `${owner}/${repo}`;
  const activeKey = useRef(requestKey);
  activeKey.current = requestKey;

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
    } catch {
      // A blocked localStorage is not worth failing the render over.
    }
  }, [isDark]);

  useEffect(() => {
    setIssueGraph(null);
    setIssueError(null);
    setCodeGraph(null);
    setCodeError(null);
    // Reset explicitly: a fetch still running for the previous repository would
    // otherwise keep this true and starve the next one.
    setLoadingCode(false);

    if (!owner || !repo) return;

    const key = requestKey;
    getIssueGraph(owner, repo)
      .then((data) => {
        if (activeKey.current !== key) return;
        setIssueGraph(data);
      })
      .catch(() => {
        if (activeKey.current !== key) return;
        setIssueError("Could not load the issue graph. Index this repository first.");
      });
  }, [owner, repo, requestKey]);

  /**
   * The code graph is fetched only once its view is opened.
   *
   * It reads every source file in the repository — one GitHub request each.
   * Fetching it alongside the issue graph meant simply opening this page paid
   * that cost even for someone who only ever looked at issues. Requested on
   * demand, and once per repository.
   */
  useEffect(() => {
    if (source !== "code" || !owner || !repo) return;
    if (codeGraph !== null || codeError !== null || loadingCode) return;

    const key = requestKey;
    setLoadingCode(true);
    getCodeGraph(owner, repo)
      .then((data) => {
        if (activeKey.current !== key) return;
        setCodeGraph(data);
      })
      .catch(() => {
        if (activeKey.current !== key) return;
        setCodeError("Could not read this repository's source files.");
      })
      .finally(() => {
        if (activeKey.current !== key) return;
        setLoadingCode(false);
      });
  }, [source, owner, repo, requestKey, codeGraph, codeError, loadingCode]);

  const pal = isDark ? PALETTE.dark : PALETTE.light;

  const controls = (
    <>
      <Pill pal={pal} onClick={() => navigate("/overview")} title="Back to the dashboard">
        <LogOut className="h-3.5 w-3.5 text-red-400" />
        Exit
      </Pill>
      <div
        className="flex items-center gap-1 rounded-full border p-1 shadow-2xl backdrop-blur-md"
        style={{ background: pal.overlayBg, borderColor: pal.border }}
      >
        {(
          [
            ["code", "Code", Code2],
            ["issues", "Issues", Network],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSource(id)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors"
            style={{
              background: source === id ? "rgba(168,85,247,0.25)" : "transparent",
              color: source === id ? pal.text : pal.mutedText,
            }}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
    </>
  );

  if (!owner || !repo) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-6">
        <h1 className="text-lg font-semibold text-text-primary">Graph explorer</h1>
        <p className="mt-1 text-sm text-text-muted">
          Select a repository to open its graphs.
        </p>
      </div>
    );
  }

  const fallback = (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: pal.bg }}
    >
      <Loader2 className="h-7 w-7 animate-spin" style={{ color: ACCENT }} />
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      {source === "code" ? (
        <CodeExplorer
          controls={controls}
          error={codeError}
          graph={codeGraph}
          isDark={isDark}
          loading={loadingCode || (codeGraph === null && codeError === null)}
          onToggleTheme={() => setIsDark((value) => !value)}
          repoName={repoName}
        />
      ) : (
        <IssueExplorer
          controls={controls}
          error={issueError}
          graph={issueGraph}
          isDark={isDark}
          loading={issueGraph === null && issueError === null}
          onToggleTheme={() => setIsDark((value) => !value)}
          repoName={repoName}
        />
      )}
    </Suspense>
  );
}
