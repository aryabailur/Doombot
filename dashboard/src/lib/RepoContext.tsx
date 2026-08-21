import { createContext, useContext, useState, type ReactNode } from "react";

interface RepoContextValue {
  repoName: string;
  owner: string;
  repo: string;
  setRepoName: (name: string) => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

const DEFAULT_REPO = "octocat/Hello-World";

// A bare "owner/repo" shape check — this is the one real gate every caller
// of setRepoName goes through (Sidebar.tsx's own input validation guards
// its UI, but doesn't stop something else calling setRepoName directly, or
// a stale unvalidated value already sitting in localStorage from before
// this check existed — both were confirmed as the real source of malformed
// "owner"-with-no-slash rows in health_scores/investigations).
function isValidRepoName(name: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(name);
}

export function RepoProvider({ children }: { children: ReactNode }) {
  const [repoName, setRepoNameState] = useState(() => {
    const stored = localStorage.getItem("repoguardian:repo");
    return stored && isValidRepoName(stored) ? stored : DEFAULT_REPO;
  });

  function setRepoName(name: string) {
    if (!isValidRepoName(name)) return;
    setRepoNameState(name);
    localStorage.setItem("repoguardian:repo", name);
  }

  const [owner, repo] = repoName.split("/");

  return (
    <RepoContext.Provider value={{ repoName, owner: owner ?? "", repo: repo ?? "", setRepoName }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepo must be used within RepoProvider");
  return ctx;
}
