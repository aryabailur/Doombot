import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Code2, Loader2, LogOut, Network } from "lucide-react";

import { useRepo } from "../lib/RepoContext";
import { getCodeGraph, getIssueGraph } from "../lib/api";
import type { CodeGraphResponseApi, IssueGraphResponseApi } from "../lib/types";
import { Pill } from "../components/explorer/chrome";
import { ACCENT, PALETTE } from "../components/explorer/theme";

/**
 * Both explorers are lazily loaded.
 *
 * They are only reachable from this one route, and between them they pull in
 * the canvas renderers, the layout code, and the analysis passes. Loaded
 * eagerly they would sit in the entry bundle that the other eleven routes have
 * to download before anything renders.
 */
const CodeExplorer = lazy(() =>
  import("../components/explorer/CodeExplorer").then((module) => ({
    default: module.CodeExplorer,
  }))
);
const IssueExplorer = lazy(() =>
  import("../components/explorer/IssueExplorer").then((module) => ({
    default: module.IssueExplorer,
  }))
);

type Source = "issues" | "code";

const THEME_KEY = "repoguardian.explorer.theme";

/**
 * The graph explorer route: a full-bleed, CodeGraphContext-style workspace over
 * RepoGuardian's two graphs.
 *
 * This page is deliberately a thin shell. It owns the two fetches, the source
 * switch, and the theme, and nothing else — the previous version held both
 * canvases, both filter sets, both painters and two focus models in one
 * ~700-line component, where any change to one half risked the other.
 *
 * It renders as `fixed inset-0` over the dashboard chrome rather than inside the
 * page column, which is what makes the canvas full-bleed. "Exit" goes back to
 * the Command Center.
 */
export function Graphs() {
  const { repoName } = useRepo();
  const navigate = useNavigate();

  const [source, setSource] = useState<Source>("code");
  const [isDark, setIsDark] = useState(() => {
    try {
      return window.localStorage.getItem(THEME_KEY) !== "light";
    } catch {
      return true;
    }
  });

  const [issueGraph, setIssueGraph] = useState<IssueGraphResponseApi | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [codeGraph, setCodeGraph] = useState<CodeGraphResponseApi | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  /** Real state, not derived: "not fetched yet" and "fetching now" differ. */
  const [loadingCode, setLoadingCode] = useState(false);

  const [owner, repo] = repoName.split("/");

  /**
   * Which repository the in-flight requests belong to.
   *
   * The code graph can take the better part of a minute, which is long enough
   * for the reader to switch repositories mid-flight. Without this key two
   * things went wrong: the stale response populated the *previous* repository's
   * graph under the new name, and `loadingCode` stayed true so the guard below
   * blocked the new fetch permanently — the panel sat on "Reading source…" for
   * a request nobody was making.
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
        setIssueError(
          "Could not load the issue graph. Index this repository first."
        );
      });
  }, [owner, repo, requestKey]);

  /**
   * The code graph is fetched only once its view is opened.
   *
   * It reads every source file in the repository — one GitHub request each —
   * and measured 43s on yt-dlp. Fetching it alongside the issue graph meant
   * simply opening this page paid that cost even for someone who only ever
   * looked at issues. Requested on demand, and once per repository.
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
      <Pill pal={pal} onClick={() => navigate("/")} title="Back to the dashboard">
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
      <div className="rounded-2xl border border-border bg-card p-6 shadow-flat">
        <h1 className="text-2xl font-extrabold text-ink">Graph explorer</h1>
        <p className="mt-1 text-sm text-muted">
          Pick a repository in the sidebar to open its graphs.
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
          repoName={repoName}
          graph={codeGraph}
          loading={loadingCode || (codeGraph === null && codeError === null)}
          error={codeError}
          isDark={isDark}
          onToggleTheme={() => setIsDark((value) => !value)}
          controls={controls}
        />
      ) : (
        <IssueExplorer
          repoName={repoName}
          graph={issueGraph}
          loading={issueGraph === null && issueError === null}
          error={issueError}
          isDark={isDark}
          onToggleTheme={() => setIsDark((value) => !value)}
          controls={controls}
        />
      )}
    </Suspense>
  );
}
