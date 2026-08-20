import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import { getHealth, indexRepo, getRepoGraph, getRepos } from "../lib/api";
import type { RepoSummaryApi } from "../lib/types";
import { SystemDiagram, type DiagramStage } from "../components/FirstRun/SystemDiagram";

/**
 * Mirrors Sidebar.tsx's `normalizeRepoInput` exactly (same accepted forms:
 * bare "owner/repo", a github.com URL with/without protocol, www, .git
 * suffix, or trailing slash). Duplicated here rather than imported because
 * Sidebar.tsx is Person D's file and out of scope for this task, and
 * extracting a shared lib helper is likewise out of scope — see the task
 * brief. Keep this in sync with Sidebar.tsx by hand if either changes.
 */
function normalizeRepoInput(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^git@github\.com:/, "");
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  const match = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

type FirstRunState = "idle" | "connecting" | "checking" | "indexing" | "ready";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Poll getRepoGraph() roughly every 2s, capped at 15 attempts (~30s) before
 * we stop waiting and let the user proceed anyway — repos can legitimately
 * take longer to index than a demo can sit and watch. */
const POLL_INTERVAL_MS = 2000;
const POLL_CAP = 15;

export function FirstRun() {
  const { setRepoName } = useRepo();
  const prefersReduced = useReducedMotion();

  const [state, setState] = useState<FirstRunState>("idle");

  // idle: background, non-blocking health status
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  // connecting: repo entry form
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState(false);
  const [targetRepo, setTargetRepo] = useState<{ owner: string; repo: string } | null>(null);

  // checking: real health re-check gating the flow
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);

  // indexing: the two real, honest stages
  const [indexRequested, setIndexRequested] = useState(false);
  const [graphBuilt, setGraphBuilt] = useState(false);
  const [pollCapped, setPollCapped] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexAttempt, setIndexAttempt] = useState(0);
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ready: real numbers from getRepos()
  const [repoSummary, setRepoSummary] = useState<RepoSummaryApi | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);

  // idle: fire a background health check on mount. Informational only —
  // never blocks the CTA.
  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then(() => {
        if (!cancelled) setBackendOnline(true);
      })
      .catch(() => {
        if (!cancelled) setBackendOnline(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openConnectForm() {
    setState("connecting");
  }

  function submitRepo() {
    const normalized = normalizeRepoInput(draft);
    if (!normalized) {
      setInputError(true);
      return;
    }
    const [owner, repo] = normalized.split("/");
    setTargetRepo({ owner, repo });
    setInputError(false);
    setState("checking");
  }

  // checking: real getHealth() call gates progression. Failure surfaces a
  // real error + retry, success proceeds straight to indexing.
  useEffect(() => {
    if (state !== "checking") return;
    let cancelled = false;
    setCheckError(null);
    getHealth()
      .then(() => {
        if (cancelled) return;
        setState("indexing");
      })
      .catch(() => {
        if (cancelled) return;
        setCheckError("Agent backend is unreachable — make sure the API server is running.");
      });
    return () => {
      cancelled = true;
    };
    // checkAttempt is bumped by retryCheck() to force a fresh health check
    // without leaving the "checking" state (and without a visible bounce
    // through the idle screen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, checkAttempt]);

  function retryCheck() {
    setCheckError(null);
    setCheckAttempt((n) => n + 1);
  }

  // indexing: fire indexRepo() once, then poll getRepoGraph() for a real
  // signal that GitHub data has actually landed.
  useEffect(() => {
    if (state !== "indexing" || !targetRepo) return;
    let cancelled = false;
    setIndexRequested(false);
    setGraphBuilt(false);
    setPollCapped(false);
    setIndexError(null);
    pollCountRef.current = 0;

    const { owner, repo } = targetRepo;

    indexRepo(owner, repo)
      .then(() => {
        if (cancelled) return;
        // Real signal: the backend accepted the fire-and-forget index
        // request. It does NOT mean indexing finished.
        setIndexRequested(true);
        pollGraph();
      })
      .catch(() => {
        if (cancelled) return;
        setIndexError("Could not start indexing — the request to the API server failed.");
      });

    function pollGraph() {
      if (cancelled) return;
      getRepoGraph(owner, repo)
        .then((res) => {
          if (cancelled) return;
          const fileCount = Number(res.metadata?.file_count ?? 0);
          if (fileCount > 0) {
            setGraphBuilt(true);
            setState("ready");
            return;
          }
          pollCountRef.current += 1;
          if (pollCountRef.current >= POLL_CAP) {
            setPollCapped(true);
            setState("ready");
            return;
          }
          pollTimerRef.current = setTimeout(pollGraph, POLL_INTERVAL_MS);
        })
        .catch(() => {
          if (cancelled) return;
          pollCountRef.current += 1;
          if (pollCountRef.current >= POLL_CAP) {
            setPollCapped(true);
            setState("ready");
            return;
          }
          pollTimerRef.current = setTimeout(pollGraph, POLL_INTERVAL_MS);
        });
    }

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // indexAttempt is bumped by retryIndexing() to force a fresh index+poll
    // cycle without leaving the "indexing" state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, targetRepo, indexAttempt]);

  function retryIndexing() {
    setIndexError(null);
    setIndexAttempt((n) => n + 1);
  }

  // ready: load real repo summary numbers, matched by repo_name.
  useEffect(() => {
    if (state !== "ready" || !targetRepo) return;
    let cancelled = false;
    const fullName = `${targetRepo.owner}/${targetRepo.repo}`;
    getRepos()
      .then((repos) => {
        if (cancelled) return;
        const match = repos.find((r) => r.repo_name === fullName) ?? null;
        setRepoSummary(match);
        setSummaryLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setRepoSummary(null);
        setSummaryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [state, targetRepo]);

  function enterCommandCenter() {
    if (!targetRepo) return;
    setRepoName(`${targetRepo.owner}/${targetRepo.repo}`);
    // No manual navigation: App.tsx flips `hasRepo` and swaps the whole
    // app into Layout+routes automatically on this re-render.
  }

  const diagramStage: DiagramStage = indexRequested ? (graphBuilt || pollCapped ? 2 : 1) : 0;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
        <AnimatePresence mode="wait">
          {state === "idle" && (
            <IdleScreen
              key="idle"
              backendOnline={backendOnline}
              onEnter={openConnectForm}
              prefersReduced={!!prefersReduced}
            />
          )}

          {state === "connecting" && (
            <ConnectingScreen
              key="connecting"
              draft={draft}
              onDraftChange={(v) => {
                setDraft(v);
                setInputError(false);
              }}
              inputError={inputError}
              onSubmit={submitRepo}
              prefersReduced={!!prefersReduced}
            />
          )}

          {state === "checking" && (
            <CheckingScreen
              key="checking"
              error={checkError}
              onRetry={retryCheck}
              prefersReduced={!!prefersReduced}
            />
          )}

          {state === "indexing" && targetRepo && (
            <IndexingScreen
              key="indexing"
              owner={targetRepo.owner}
              repo={targetRepo.repo}
              indexRequested={indexRequested}
              graphBuilt={graphBuilt}
              pollCapped={pollCapped}
              indexError={indexError}
              onRetry={retryIndexing}
              diagramStage={diagramStage}
              prefersReduced={!!prefersReduced}
            />
          )}

          {state === "ready" && targetRepo && (
            <ReadyScreen
              key="ready"
              owner={targetRepo.owner}
              repo={targetRepo.repo}
              summaryLoaded={summaryLoaded}
              repoSummary={repoSummary}
              onEnter={enterCommandCenter}
              prefersReduced={!!prefersReduced}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// idle
// ---------------------------------------------------------------------------

interface IdleScreenProps {
  backendOnline: boolean | null;
  onEnter: () => void;
  prefersReduced: boolean;
}

function stagger(index: number, prefersReduced: boolean) {
  const delays = [0, 0.1, 0.18, 0.26, 0.3, 0.42, 0.52];
  const delay = prefersReduced ? 0 : (delays[index] ?? 0);
  return {
    initial: { opacity: 0, y: prefersReduced ? 0 : 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: prefersReduced ? 0.01 : 0.5, delay, ease: EASE },
  };
}

function IdleScreen({ backendOnline, onEnter, prefersReduced }: IdleScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: prefersReduced ? 0.01 : 0.2 } }}
      className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]"
    >
      <div className="flex flex-col gap-6">
        <motion.div {...stagger(0, prefersReduced)} className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink">
            <span className="font-mono text-sm font-bold text-white">■</span>
          </div>
          <span className="font-mono text-sm font-extrabold uppercase tracking-wide text-ink">
            RepoGuardian
          </span>
        </motion.div>

        <motion.p
          {...stagger(1, prefersReduced)}
          className="font-mono text-xs font-bold uppercase tracking-widest text-accent"
        >
          Autonomous Repository Agent
        </motion.p>

        <motion.h1
          {...stagger(2, prefersReduced)}
          className="text-4xl font-extrabold leading-[1.1] tracking-tight text-ink lg:text-5xl"
        >
          Your repository
          <br />
          has an agent now.
        </motion.h1>

        <motion.p {...stagger(3, prefersReduced)} className="max-w-md text-base text-ink/70">
          It reads issues, code, and history, then reasons toward a decision it can show its
          work for — and escalates only what actually needs you.
        </motion.p>

        <motion.div {...stagger(5, prefersReduced)}>
          <button
            onClick={onEnter}
            className="group flex items-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-flat-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-flat active:translate-y-0 active:shadow-flat-sm"
          >
            Enter a Repository
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2.5} />
          </button>
        </motion.div>

        <motion.div {...stagger(6, prefersReduced)} className="flex items-center gap-1.5 pt-2">
          {backendOnline === null ? (
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
              Checking agent backend…
            </span>
          ) : backendOnline ? (
            <div className="flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-success animate-agent-pulse-ring" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
              </span>
              <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-success">
                Agent Backend Online
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg bg-danger-soft px-3 py-1.5">
              <span className="relative h-1.5 w-1.5 rounded-full bg-danger" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-danger">
                Agent Backend Unreachable
              </span>
            </div>
          )}
        </motion.div>
      </div>

      <motion.div
        {...stagger(4, prefersReduced)}
        className="flex items-center justify-center rounded-2xl border border-border bg-card p-8 shadow-flat-sm"
      >
        <SystemDiagram className="h-auto w-full max-w-sm" />
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// connecting
// ---------------------------------------------------------------------------

interface ConnectingScreenProps {
  draft: string;
  onDraftChange: (v: string) => void;
  inputError: boolean;
  onSubmit: () => void;
  prefersReduced: boolean;
}

function ConnectingScreen({ draft, onDraftChange, inputError, onSubmit, prefersReduced }: ConnectingScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: prefersReduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: prefersReduced ? 0 : -8, transition: { duration: prefersReduced ? 0.01 : 0.2 } }}
      transition={{ duration: prefersReduced ? 0.01 : 0.45, ease: EASE }}
      className="mx-auto flex w-full max-w-md flex-col gap-6"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink">
          <span className="font-mono text-sm font-bold text-white">■</span>
        </div>
        <span className="font-mono text-sm font-extrabold uppercase tracking-wide text-ink">RepoGuardian</span>
      </div>

      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">Which repository?</h2>
        <p className="mt-1 text-sm text-ink/70">
          Enter it as <span className="font-mono">owner/repo</span>, or paste a GitHub URL.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="owner/repo or a GitHub URL"
          className={`w-full rounded-lg border bg-card px-4 py-3 font-mono text-sm text-ink outline-none ${
            inputError ? "border-danger" : "border-border"
          }`}
        />
        {inputError && (
          <p className="text-[12px] text-danger">
            Enter as "owner/repo" (a pasted GitHub URL also works).
          </p>
        )}
      </div>

      <button
        onClick={onSubmit}
        disabled={!draft.trim()}
        className="flex items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-flat-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-flat active:translate-y-0 active:shadow-flat-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-flat-sm"
      >
        Connect
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// checking
// ---------------------------------------------------------------------------

interface CheckingScreenProps {
  error: string | null;
  onRetry: () => void;
  prefersReduced: boolean;
}

function CheckingScreen({ error, onRetry, prefersReduced }: CheckingScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: prefersReduced ? 0.01 : 0.2 } }}
      transition={{ duration: prefersReduced ? 0.01 : 0.35, ease: EASE }}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-5 text-center"
    >
      {error ? (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
            <span className="h-2 w-2 rounded-full bg-danger" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-ink">Backend unreachable</h2>
            <p className="mt-1 text-sm text-ink/70">{error}</p>
          </div>
          <button
            onClick={onRetry}
            className="rounded-lg border border-border bg-card px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-ink shadow-flat-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-flat"
          >
            Retry
          </button>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-accent" strokeWidth={2.5} />
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
            Checking Agent Backend…
          </p>
        </>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// indexing
// ---------------------------------------------------------------------------

interface IndexingScreenProps {
  owner: string;
  repo: string;
  indexRequested: boolean;
  graphBuilt: boolean;
  pollCapped: boolean;
  indexError: string | null;
  onRetry: () => void;
  diagramStage: DiagramStage;
  prefersReduced: boolean;
}

function IndexingScreen({
  owner,
  repo,
  indexRequested,
  graphBuilt,
  pollCapped,
  indexError,
  onRetry,
  diagramStage,
  prefersReduced,
}: IndexingScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: prefersReduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: prefersReduced ? 0 : -8, transition: { duration: prefersReduced ? 0.01 : 0.2 } }}
      transition={{ duration: prefersReduced ? 0.01 : 0.45, ease: EASE }}
      className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]"
    >
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-8 shadow-flat-sm">
        <SystemDiagram activeStage={diagramStage} className="h-auto w-full max-w-sm" />
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-accent">Connecting</p>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">
            {owner}/{repo}
          </h2>
        </div>

        {indexError ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-danger-soft px-4 py-4">
            <p className="text-sm text-ink">{indexError}</p>
            <button
              onClick={onRetry}
              className="w-fit rounded-lg border border-border bg-card px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink shadow-flat-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-flat"
            >
              Retry
            </button>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            <IndexStage
              done={indexRequested}
              active={!indexRequested}
              label="Indexing requested"
              detail="The backend accepted the request. This confirms it was received, not that indexing has finished."
            />
            <IndexStage
              done={graphBuilt || pollCapped}
              active={indexRequested && !graphBuilt && !pollCapped}
              label="Building repository graph"
              detail={
                graphBuilt
                  ? "Real file data has landed from GitHub."
                  : pollCapped
                    ? "Still indexing in the background — you can continue. Large repositories can take longer."
                    : "Waiting for the first real signal that GitHub data has landed…"
              }
            />
          </ol>
        )}
      </div>
    </motion.div>
  );
}

interface IndexStageProps {
  done: boolean;
  active: boolean;
  label: string;
  detail: string;
}

function IndexStage({ done, active, label, detail }: IndexStageProps) {
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-flat-sm">
      <div className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center">
        {done ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          </span>
        ) : active ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={2.5} />
        ) : (
          <span className="h-4 w-4 rounded-full border-2 border-border" />
        )}
      </div>
      <div>
        <p className="text-sm font-bold text-ink">{label}</p>
        <p className="mt-0.5 text-xs text-ink/60">{detail}</p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// ready
// ---------------------------------------------------------------------------

interface ReadyScreenProps {
  owner: string;
  repo: string;
  summaryLoaded: boolean;
  repoSummary: RepoSummaryApi | null;
  onEnter: () => void;
  prefersReduced: boolean;
}

function ReadyScreen({ owner, repo, summaryLoaded, repoSummary, onEnter, prefersReduced }: ReadyScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: prefersReduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: prefersReduced ? 0.01 : 0.2 } }}
      transition={{ duration: prefersReduced ? 0.01 : 0.45, ease: EASE }}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-6 text-center"
    >
      <div className="flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 rounded-full bg-success animate-agent-pulse-ring" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
        </span>
        <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-success">Agent Online</span>
      </div>

      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">
          {owner}/{repo}
        </h2>
        <p className="mt-2 text-sm text-ink/70">
          {!summaryLoaded
            ? "Loading repository status…"
            : repoSummary && repoSummary.open_investigations > 0
              ? `${repoSummary.open_investigations} need${repoSummary.open_investigations === 1 ? "s" : ""} your attention.`
              : "No investigations yet — the agent will start triaging on the next scan."}
        </p>
      </div>

      <button
        onClick={onEnter}
        className="group flex items-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-flat-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-flat active:translate-y-0 active:shadow-flat-sm"
      >
        Enter Command Center
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2.5} />
      </button>
    </motion.div>
  );
}
