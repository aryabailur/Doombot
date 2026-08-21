import { useMemo } from "react";
import { X, ExternalLink, MessageCircleQuestion } from "lucide-react";
import type { GraphNode, GraphLink, GraphNodeType } from "./CodeGraphViewer";

// ---------------------------------------------------------------------------
// Honest relationship labels only. The backend graph has exactly three link
// types — CONTAINS, EVIDENCE, DECIDED — and nothing resembling an import or
// call graph exists anywhere in this system. Never introduce "Depends On" /
// "Imports" / "Used By" vocabulary here, even if a design mockup uses it.
// ---------------------------------------------------------------------------

const NODE_ICONS: Record<GraphNodeType, string> = {
  Repository: "\u{1F310}",
  Directory: "\u{1F4C1}",
  File: "\u{1F4C4}",
  Issue: "\u{1F41B}",
  PullRequest: "\u{1F500}",
  Decision: "\u{2696}\u{FE0F}",
};

const NODE_COLORS: Record<GraphNodeType, string> = {
  Repository: "var(--ink)",
  Directory: "var(--warning)",
  File: "var(--info)",
  Issue: "var(--danger)",
  PullRequest: "var(--accent)",
  Decision: "var(--success)",
};

export interface NodeDetailPanelProps {
  node: GraphNode;
  nodes: GraphNode[];
  links: GraphLink[];
  repoName: string;
  onClose: () => void;
  onAskAboutNode?: (nodeContext: string) => void;
}

function linkEndpointId(end: GraphLink["source"]): string {
  return typeof end === "object" ? end.id : end;
}

export function NodeDetailPanel({ node, nodes, links, repoName, onClose, onAskAboutNode }: NodeDetailPanelProps) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const containedBy = useMemo(() => {
    const parent = links.find((l) => l.type === "CONTAINS" && linkEndpointId(l.target) === node.id);
    return parent ? nodeMap.get(linkEndpointId(parent.source)) ?? null : null;
  }, [links, node.id, nodeMap]);

  const contains = useMemo(() => {
    return links
      .filter((l) => l.type === "CONTAINS" && linkEndpointId(l.source) === node.id)
      .map((l) => nodeMap.get(linkEndpointId(l.target)))
      .filter((n): n is GraphNode => Boolean(n));
  }, [links, node.id, nodeMap]);

  const referencedFiles = useMemo(() => {
    if (node.type !== "Issue" && node.type !== "PullRequest") return [];
    return links
      .filter((l) => l.type === "EVIDENCE" && linkEndpointId(l.source) === node.id)
      .map((l) => ({ file: nodeMap.get(linkEndpointId(l.target)), score: l.score }))
      .filter((e): e is { file: GraphNode; score: number | null } => Boolean(e.file));
  }, [links, node.id, node.type, nodeMap]);

  const decision = useMemo(() => {
    if (node.type !== "Issue" && node.type !== "PullRequest") return null;
    const link = links.find((l) => l.type === "DECIDED" && linkEndpointId(l.source) === node.id);
    if (!link) return null;
    const decisionNode = nodeMap.get(linkEndpointId(link.target));
    return decisionNode ? { node: decisionNode, score: link.score } : null;
  }, [links, node.id, node.type, nodeMap]);

  const relatedInvestigations = useMemo(() => {
    if (node.type !== "File") return [];
    return links
      .filter((l) => l.type === "EVIDENCE" && linkEndpointId(l.target) === node.id)
      .map((l) => ({ investigation: nodeMap.get(linkEndpointId(l.source)), score: l.score }))
      .filter((e): e is { investigation: GraphNode; score: number | null } => Boolean(e.investigation));
  }, [links, node.id, node.type, nodeMap]);

  const githubUrl = node.file ? `https://github.com/${repoName}/blob/main/${node.file}` : null;

  return (
    <aside
      className="animate-rise-in flex w-80 flex-none flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-flat-sm"
      aria-label="Node details"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border text-sm"
            style={{ backgroundColor: NODE_COLORS[node.type] }}
          >
            {NODE_ICONS[node.type]}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">{node.name}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{node.type}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close node details"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-muted hover:bg-background hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {(node.type === "File" || node.type === "Directory") && node.file && (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted">Path</p>
          <p className="break-all rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-ink">
            {node.file}
          </p>
        </div>
      )}

      {(containedBy || contains.length > 0) && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {containedBy && (
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">Contained By</p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
                <span className="text-xs">{NODE_ICONS[containedBy.type]}</span>
                <span className="truncate text-xs font-semibold text-ink">{containedBy.name}</span>
              </div>
            </div>
          )}
          {contains.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                Directory Contents ({contains.length})
              </p>
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {contains.map((child) => (
                  <li
                    key={child.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5"
                  >
                    <span className="text-xs">{NODE_ICONS[child.type]}</span>
                    <span className="truncate text-xs font-semibold text-ink">{child.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(node.type === "Issue" || node.type === "PullRequest") && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">Referenced Files</p>
            {referencedFiles.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-background px-2.5 py-2 text-xs text-muted">
                No files matched by evidence for this investigation yet — the triage pipeline
                didn't emit a file-typed evidence reference here.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {referencedFiles.map(({ file, score }) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5"
                  >
                    <span className="truncate font-mono text-xs text-ink">{file.file ?? file.name}</span>
                    {score !== null && (
                      <span className="flex-none font-mono text-[10px] text-muted">{Math.round(score * 100)}%</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {decision && (
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">Decision</p>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-success-soft px-2.5 py-1.5">
                <span className="truncate text-xs font-bold text-ink">{decision.node.name}</span>
                {decision.score !== null && (
                  <span className="flex-none font-mono text-[10px] text-muted">
                    {Math.round(decision.score * 100)}% confidence
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {node.type === "File" && (
        <div className="border-t border-border pt-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">Related Investigations</p>
          {relatedInvestigations.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-background px-2.5 py-2 text-xs text-muted">
              No investigation currently references this file via matched evidence.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {relatedInvestigations.map(({ investigation, score }) => (
                <li
                  key={investigation.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5"
                >
                  <span className="truncate text-xs font-semibold text-ink">{investigation.name}</span>
                  {score !== null && (
                    <span className="flex-none font-mono text-[10px] text-muted">{Math.round(score * 100)}%</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        {githubUrl && (
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-xs font-bold uppercase tracking-wide text-ink transition-colors hover:bg-card"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
            View on GitHub
          </a>
        )}
        {onAskAboutNode && (
          <button
            type="button"
            onClick={() => onAskAboutNode(`What should I know about ${node.file ?? node.name}?`)}
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-ink text-xs font-bold uppercase tracking-wide text-white transition-colors hover:opacity-90"
          >
            <MessageCircleQuestion className="h-3.5 w-3.5" strokeWidth={2.5} />
            Ask RepoGuardian
          </button>
        )}
      </div>
    </aside>
  );
}
