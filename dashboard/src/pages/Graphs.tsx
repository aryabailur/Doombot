import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Network, Code2 } from "lucide-react";

import { useRepo } from "../lib/RepoContext";
import { getCodeGraph, getIssueGraph } from "../lib/api";
import type {
  CodeGraphResponseApi,
  IssueGraphLinkApi,
  IssueGraphNodeApi,
  IssueGraphResponseApi,
} from "../lib/types";

/**
 * react-force-graph-2d touches `window` at module scope, so a static import
 * throws wherever there is no DOM. It also pulls in d3-force, which is by far
 * the heaviest dependency here and is needed on exactly one route -- lazy
 * loading keeps it out of the initial bundle for the other eleven.
 */
const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

type View = "issues" | "code";

/**
 * Colours are read from the stylesheet rather than hardcoded.
 *
 * The canvas renderer needs literal colour strings -- it cannot resolve a
 * Tailwind class -- but duplicating the palette here would let it drift from
 * index.css. Reading the custom property at paint time keeps the graph on the
 * same palette as every other surface.
 */
function token(name: string): string {
  if (typeof window === "undefined") return "#111111";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || "#111111";
}

const CATEGORY_TOKEN: Record<string, string> = {
  security: "--danger",
  duplicate: "--info",
  stale: "--warning",
  resolved: "--success",
  open: "--muted",
};

const CATEGORY_LABEL: Record<string, string> = {
  security: "Security",
  duplicate: "Duplicate",
  stale: "Stale",
  resolved: "Resolved",
  open: "Open",
};

const LINK_LABEL: Record<string, string> = {
  duplicate: "Likely duplicate",
  similar: "Related",
  reference: "Explicit reference",
  metadata: "Shared label",
};

/** The simulation replaces string endpoints with node objects after tick one. */
function endpointId(endpoint: unknown): string {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
    return String((endpoint as { id: unknown }).id);
  }
  return "";
}

function linkKey(link: { source: unknown; target: unknown }): string {
  return `${endpointId(link.source)}->${endpointId(link.target)}`;
}

export function Graphs() {
  const { repoName } = useRepo();
  const [view, setView] = useState<View>("issues");

  const [issueGraph, setIssueGraph] = useState<IssueGraphResponseApi | null>(null);
  const [codeGraph, setCodeGraph] = useState<CodeGraphResponseApi | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedLink, setSelectedLink] = useState<IssueGraphLinkApi | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** Hide low-connectivity symbols; the full code graph is a hairball. */
  const [minDegree, setMinDegree] = useState(2);
  const [subsystem, setSubsystem] = useState<string>("");

  const [owner, repo] = repoName.split("/");

  useEffect(() => {
    setIssueGraph(null);
    setCodeGraph(null);
    setIssueError(null);
    setCodeError(null);
    setSelectedLink(null);

    if (!owner || !repo) return;

    getIssueGraph(owner, repo)
      .then(setIssueGraph)
      .catch(() => setIssueError("Could not load the issue graph. Index the repository first."));

    getCodeGraph(owner, repo)
      .then(setCodeGraph)
      .catch(() => setCodeError("Could not read the repository's source files."));
  }, [owner, repo]);

  // ---- issue graph -------------------------------------------------------

  const issueData = useMemo(() => {
    const nodes = (issueGraph?.nodes ?? []).filter((n) => !hidden.has(n.category));
    const ids = new Set(nodes.map((n) => n.id));
    return {
      // Cloned: the simulation mutates its input, adding x/y to every node.
      nodes: nodes.map((n) => ({ ...n })),
      links: (issueGraph?.links ?? [])
        .filter((l) => ids.has(l.source) && ids.has(l.target))
        .map((l) => ({ ...l })),
    };
  }, [issueGraph, hidden]);

  const neighbourhood = useMemo(() => {
    if (!hoveredId) return null;
    const nodeIds = new Set<string>([hoveredId]);
    const edges = new Set<string>();
    for (const link of issueGraph?.links ?? []) {
      if (link.source === hoveredId || link.target === hoveredId) {
        nodeIds.add(link.source);
        nodeIds.add(link.target);
        edges.add(`${link.source}->${link.target}`);
      }
    }
    return { nodeIds, edges };
  }, [hoveredId, issueGraph]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of issueGraph?.nodes ?? []) {
      counts.set(node.category, (counts.get(node.category) ?? 0) + 1);
    }
    return counts;
  }, [issueGraph]);

  const unconnected = useMemo(() => {
    const linked = new Set<string>();
    for (const link of issueData.links) {
      linked.add(endpointId(link.source));
      linked.add(endpointId(link.target));
    }
    return issueData.nodes.filter((n) => !linked.has(n.id)).length;
  }, [issueData]);

  const paintIssueNode = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, scale: number) => {
      const node = raw as IssueGraphNodeApi & { x?: number; y?: number };
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const radius = 6 + Math.min(4, Math.sqrt(node.engagement) * 1.4);
      const colour = token(CATEGORY_TOKEN[node.category] ?? "--muted");

      const focused = neighbourhood ? neighbourhood.nodeIds.has(node.id) : true;
      ctx.globalAlpha = focused ? 1 : 0.15;

      if (node.escalated) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.2 / scale;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      // A light rim keeps touching nodes from fusing into one blob on a pale
      // background.
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = token("--card");
      ctx.stroke();

      const fontSize = Math.min(13, Math.max(9, 11 / scale));
      ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = token("--ink");
      ctx.fillText(`#${node.number}`, x, y + radius + 2 / scale);

      ctx.globalAlpha = 1;
    },
    [neighbourhood]
  );

  // ---- code graph --------------------------------------------------------

  const codeData = useMemo(() => {
    const nodes = (codeGraph?.nodes ?? []).filter((n) => {
      if (subsystem && n.cluster_label !== subsystem) return false;
      if (minDegree > 0 && n.in_degree + n.out_degree < minDegree) return false;
      return true;
    });
    const ids = new Set(nodes.map((n) => n.id));
    // Positions are precomputed server-side, so the layout is stable rather
        // than re-simulated on every mount.
    const scale = 18;
    return {
      nodes: nodes.map((n) => ({
        ...n,
        x: n.x2d * scale,
        y: n.y2d * scale,
        fx: n.x2d * scale,
        fy: n.y2d * scale,
      })),
      links: (codeGraph?.links ?? [])
        .filter((l) => ids.has(l.source) && ids.has(l.target))
        .map((l) => ({ ...l })),
    };
  }, [codeGraph, minDegree, subsystem]);

  const clusterColour = useCallback(
    (cluster: string) => {
      const palette = ["--accent", "--info", "--success", "--warning", "--security"];
      const clusters = codeGraph?.stats.clusters ?? [];
      const index = Math.max(0, clusters.indexOf(cluster));
      return token(palette[index % palette.length]);
    },
    [codeGraph]
  );

  const paintCodeNode = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, scale: number) => {
      const node = raw as CodeGraphResponseApi["nodes"][number] & {
        x?: number;
        y?: number;
      };
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const radius = 4 + Math.min(5, node.hub_score * 9);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = clusterColour(node.cluster_label);
      ctx.fill();
      ctx.lineWidth = 1.2 / scale;
      ctx.strokeStyle = token("--card");
      ctx.stroke();

      if (scale > 0.8) {
        const fontSize = Math.min(12, Math.max(8, 10 / scale));
        ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = token("--ink");
        ctx.fillText(node.symbol_name, x, y + radius + 2 / scale);
      }
    },
    [clusterColour]
  );

  function toggleCategory(category: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const loadingIssues = issueGraph === null && issueError === null;
  const loadingCode = codeGraph === null && codeError === null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Graphs</h1>
        <p className="text-sm text-muted">
          How {repoName}'s issues relate, and how its code fits together. The
          layout is the information — clusters are real, not decorative.
        </p>
      </div>

      <div className="flex w-fit items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-flat-sm">
        {(
          [
            { id: "issues" as View, label: "Issue Relationships", icon: Network },
            { id: "code" as View, label: "Code Structure", icon: Code2 },
          ]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
              view === tab.id
                ? "bg-ink text-white"
                : "text-ink/70 hover:bg-background hover:text-ink"
            }`}
          >
            <tab.icon className="h-4 w-4" strokeWidth={2.25} />
            {tab.label}
          </button>
        ))}
      </div>

      {view === "issues" ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {[...categoryCounts.entries()].map(([category, count]) => {
              const off = hidden.has(category);
              return (
                <button
                  key={category}
                  onClick={() => toggleCategory(category)}
                  aria-pressed={!off}
                  className={`flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-ink shadow-flat-sm transition-opacity ${
                    off ? "opacity-40" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: `var(${CATEGORY_TOKEN[category] ?? "--muted"})`,
                    }}
                  />
                  {CATEGORY_LABEL[category] ?? category} {count}
                </button>
              );
            })}
            <span className="ml-auto font-mono text-xs text-muted">
              {issueData.nodes.length} issues · {issueData.links.length} connections
              {unconnected > 0 ? ` · ${unconnected} unconnected` : ""}
            </span>
          </div>

          <div className="h-[520px] overflow-hidden rounded-2xl border border-border bg-card shadow-flat">
            {loadingIssues ? (
              <p className="p-6 text-sm text-muted">Building the graph…</p>
            ) : issueError ? (
              <p className="p-6 text-sm text-muted">{issueError}</p>
            ) : issueData.nodes.length === 0 ? (
              <p className="p-6 text-sm text-muted">
                No indexed issues yet — index {repoName} to build this graph.
              </p>
            ) : (
              <Suspense fallback={<p className="p-6 text-sm text-muted">Loading canvas…</p>}>
                <ForceGraph2D
                  backgroundColor={token("--card")}
                  graphData={issueData}
                  height={520}
                  cooldownTicks={120}
                  d3VelocityDecay={0.3}
                  linkColor={(raw) => {
                    const link = raw as IssueGraphLinkApi;
                    if (neighbourhood) {
                      return neighbourhood.edges.has(linkKey(link))
                        ? token("--accent")
                        : token("--border");
                    }
                    return link.kind === "reference"
                      ? token("--accent")
                      : token("--muted");
                  }}
                  linkCurvature={0.12}
                  linkDirectionalArrowLength={(raw) =>
                    (raw as IssueGraphLinkApi).kind === "reference" ? 3 : 0
                  }
                  linkLineDash={(raw) =>
                    (raw as IssueGraphLinkApi).kind === "similar" ? [2, 4] : null
                  }
                  linkWidth={(raw) => {
                    const link = raw as IssueGraphLinkApi;
                    if (neighbourhood) {
                      return neighbourhood.edges.has(linkKey(link)) ? 2.5 : 0.5;
                    }
                    return 0.8 + link.score * 1.2;
                  }}
                  nodeCanvasObject={paintIssueNode}
                  nodeLabel={(raw) => {
                    const node = raw as IssueGraphNodeApi;
                    return `#${node.number} — ${node.title}`;
                  }}
                  onLinkClick={(raw) => setSelectedLink(raw as IssueGraphLinkApi)}
                  onNodeHover={(raw) =>
                    setHoveredId(raw ? (raw as IssueGraphNodeApi).id : null)
                  }
                />
              </Suspense>
            )}
          </div>

          {/* Every edge can explain itself. An edge a maintainer cannot
              interrogate is decoration, not evidence. */}
          {selectedLink ? (
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-ink shadow-flat-sm">
              <span className="font-bold">
                {LINK_LABEL[selectedLink.kind] ?? selectedLink.kind}
              </span>{" "}
              — {selectedLink.why}
            </p>
          ) : (
            <p className="text-xs text-muted">
              Hover an issue to light its connections. Click a line to see why two
              issues are linked — solid is a likely duplicate, dashed is related,
              an arrow is an explicit reference.
            </p>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={subsystem}
              onChange={(event) => setSubsystem(event.target.value)}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-ink shadow-flat-sm"
            >
              <option value="">All subsystems</option>
              {(codeGraph?.stats.clusters ?? []).map((cluster) => (
                <option key={cluster} value={cluster}>
                  {cluster}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-ink shadow-flat-sm">
              Min connections
              <input
                type="range"
                min={0}
                max={10}
                value={minDegree}
                onChange={(event) => setMinDegree(Number(event.target.value))}
                className="w-24"
              />
              <span className="w-3 font-mono">{minDegree}</span>
            </label>

            <span className="ml-auto font-mono text-xs text-muted">
              {codeData.nodes.length} of {codeGraph?.nodes.length ?? 0} symbols ·{" "}
              {codeData.links.length} dependencies
            </span>
          </div>

          <div className="h-[520px] overflow-hidden rounded-2xl border border-border bg-card shadow-flat">
            {loadingCode ? (
              <p className="p-6 text-sm text-muted">Parsing the repository…</p>
            ) : codeError ? (
              <p className="p-6 text-sm text-muted">{codeError}</p>
            ) : codeData.nodes.length === 0 ? (
              <p className="p-6 text-sm text-muted">
                Nothing to show at this filter — lower “min connections”.
              </p>
            ) : (
              <Suspense fallback={<p className="p-6 text-sm text-muted">Loading canvas…</p>}>
                <ForceGraph2D
                  backgroundColor={token("--card")}
                  graphData={codeData}
                  height={520}
                  cooldownTicks={0}
                  enableNodeDrag={false}
                  linkColor={() => token("--muted")}
                  linkDirectionalArrowLength={2.5}
                  linkWidth={0.7}
                  nodeCanvasObject={paintCodeNode}
                  nodeLabel={(raw) => {
                    const node = raw as CodeGraphResponseApi["nodes"][number];
                    return `${node.qualname}\n${node.file_path}:${node.start_line}`;
                  }}
                />
              </Suspense>
            )}
          </div>

          <p className="text-xs text-muted">
            Colour is the subsystem, size is how central a symbol is. Positions
            are computed server-side, so the layout is the same every time you
            open it.
          </p>
        </section>
      )}
    </div>
  );
}
