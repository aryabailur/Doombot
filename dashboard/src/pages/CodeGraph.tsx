import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useRepo } from "../lib/RepoContext";
import { getRepoGraph } from "../lib/api";
import type { RepoGraphResponse } from "../lib/types";
import { CodeGraphViewer } from "../components/CodeGraph";

export function CodeGraph() {
  const { owner, repo, repoName } = useRepo();
  const [graph, setGraph] = useState<RepoGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  // "View Architecture Impact" deep link from IssueDetail.tsx, e.g.
  // /code-graph?highlight=inv:{investigation_id}. The value is passed straight
  // through as a GraphNode id — CodeGraphViewer resolves it against the real
  // loaded nodes and no-ops if it isn't found (different repo selected, etc).
  const highlightNodeId = searchParams.get("highlight") ?? undefined;

  // Loosely coupled: dispatch a window event with node context rather than
  // importing the global AskRepoGuardian modal directly. Layout.tsx listens
  // for this event and opens the modal pre-filled with the node's context.
  function handleAskAboutNode(nodeContext: string) {
    window.dispatchEvent(new CustomEvent("repoguardian:ask", { detail: { context: nodeContext, repoName } }));
  }

  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;
    setGraph(null);
    setError(null);
    getRepoGraph(owner, repo)
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the code graph for this repository.");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, repoName]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!graph) return <p className="text-sm text-muted">Loading code graph…</p>;

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Repository Architecture</h1>
          <p className="text-sm text-muted">
            How {repoName} is structured — real directories, files, and investigation evidence.
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-card p-8 shadow-flat-sm">
          <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-info">
            Not yet indexed
          </span>
          <p className="mt-3 text-lg font-bold text-ink">No graph data yet for {repoName}.</p>
          <p className="mt-2 max-w-xl text-sm text-ink/70">
            The code graph is built from repository structure and investigation evidence. Index
            this repository and run at least one investigation from Command Center before this
            page has anything to render.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Repository Architecture</h1>
        <p className="text-sm text-muted">
          How {repoName} is structured, and where issues and pull requests connect to it.
        </p>
      </div>

      <CodeGraphViewer
        nodes={graph.nodes}
        links={graph.links}
        repoName={repoName}
        initialFocusNodeId={highlightNodeId}
        onAskAboutNode={handleAskAboutNode}
      />
    </div>
  );
}
