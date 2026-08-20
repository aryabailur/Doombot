import { createContext, useContext, useState, type ReactNode } from "react";

interface RepoContextValue {
  repoName: string;
  owner: string;
  repo: string;
  setRepoName: (name: string) => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

const DEFAULT_REPO = "octocat/Hello-World";

export function RepoProvider({ children }: { children: ReactNode }) {
  const [repoName, setRepoNameState] = useState(
    () => localStorage.getItem("repoguardian:repo") ?? DEFAULT_REPO
  );

  function setRepoName(name: string) {
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
