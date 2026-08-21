import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods as ForceGraphMethods2D, type NodeObject as NodeObject2D } from "react-force-graph-2d";
import ForceGraph3D, { type ForceGraphMethods as ForceGraphMethods3D, type NodeObject as NodeObject3D } from "react-force-graph-3d";
import * as THREE from "three";
import type { GraphNode as ApiGraphNode, GraphLink as ApiGraphLink } from "../../lib/types";
import { ModeSelector, type GraphVisualizationMode } from "./ModeSelector";
import { GraphLegend, type LegendEntry } from "./GraphLegend";
import { GraphControls } from "./GraphControls";
import { FlowchartView } from "./FlowchartView";
import { NodeDetailPanel } from "./NodeDetailPanel";

// ---------------------------------------------------------------------------
// Types — re-exported from lib/types.ts (the single mirror of api/schemas.py)
// so this directory has no second source of truth for the graph shape. The
// force-graph libraries mutate `source`/`target` in place from an id string
// to the resolved node object once the simulation runs, so link endpoints are
// typed slightly wider here than the wire shape.
// ---------------------------------------------------------------------------

export type GraphNodeType = ApiGraphNode["type"];
export type GraphLinkType = ApiGraphLink["type"];

export type GraphNode = ApiGraphNode;

export interface GraphLink extends Omit<ApiGraphLink, "source" | "target"> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface CodeGraphViewerProps {
  nodes: GraphNode[];
  links: GraphLink[];
  repoName: string;
  /** Node id to focus on mount, e.g. from a "View Architecture Impact" deep link (`inv:{investigation_id}`). */
  initialFocusNodeId?: string;
  /** Loosely-coupled hook for a future "Ask RepoGuardian" modal — receives a short node context string. */
  onAskAboutNode?: (nodeContext: string) => void;
}

// ---------------------------------------------------------------------------
// Design mapping — RepoGuardian palette only (src/index.css tokens), never a
// raw hex invented for this feature. Rationale for the mapping, per node type:
//
//   Repository  -> --ink      the root of everything, rendered as the "anchor" color
//   Directory   -> --warning  structural/organizational, matches Sidebar's folder-ish amber
//   File        -> --info     content leaves, blue reads as "informational/neutral data"
//   Issue       -> --danger   matches SeverityBadge/DecisionBadge convention elsewhere
//   PullRequest -> --accent   RepoGuardian's brand orange marks the primary actionable unit
//   Decision    -> --success  matches EvidenceGraph's decision-node convention (verdict = outcome)
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<GraphNodeType, string> = {
  Repository: "var(--ink)",
  Directory: "var(--warning)",
  File: "var(--info)",
  Issue: "var(--danger)",
  PullRequest: "var(--accent)",
  Decision: "var(--success)",
};

const NODE_ICONS: Record<GraphNodeType, string> = {
  Repository: "\u{1F310}", // globe
  Directory: "\u{1F4C1}", // folder
  File: "\u{1F4C4}", // page
  Issue: "\u{1F41B}", // bug
  PullRequest: "\u{1F500}", // twisted arrows (PR-ish)
  Decision: "\u{2696}\u{FE0F}", // balance scale
};

const LINK_COLORS: Record<GraphLinkType, string> = {
  CONTAINS: "var(--border)",
  EVIDENCE: "var(--info)",
  DECIDED: "var(--success)",
};

// Graph canvas has its own dark background, independent of the (light-only)
// app shell — node glow/ring effects read better against dark, and this
// matches the reference viewer's canvas convention. Only the viewport fill
// and label ink flip; node/link hues stay the same across both.
const CANVAS_BG = "#0b0d12";
const CANVAS_LABEL_INK = "#f4f4f5";
const CANVAS_LABEL_MUTED = "#9a9aa3";
const CANVAS_LABEL_SHADOW = "#000000";

// Resolve CSS custom-property strings ("var(--info)") to concrete hex for canvas/three.js use,
// since neither <canvas> fillStyle nor THREE.Color reliably resolve CSS variables.
const RESOLVED_HEX: Record<string, string> = {
  "var(--ink)": "#111111",
  "var(--warning)": "#e7a928",
  "var(--info)": "#246bfe",
  "var(--danger)": "#e5484d",
  "var(--accent)": "#ff5a36",
  "var(--success)": "#19a974",
  "var(--border)": "#d9d8d2",
};

function resolveColor(token: string): string {
  return RESOLVED_HEX[token] ?? token;
}

function linkEndpointId(end: GraphLink["source"]): string {
  return typeof end === "object" ? end.id : end;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.startsWith("#") ? hex : (RESOLVED_HEX[hex] ?? "#737373");
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface FocusSet {
  nodes: Set<string>;
  links: Set<GraphLink>;
}

export function CodeGraphViewer({ nodes, links, repoName, initialFocusNodeId, onAskAboutNode }: CodeGraphViewerProps) {
  const [mode, setMode] = useState<GraphVisualizationMode>("classic");
  const [visibleTypes, setVisibleTypes] = useState<Set<GraphNodeType>>(
    () => new Set(["Repository", "Directory", "File", "Issue", "PullRequest", "Decision"]),
  );
  const [search, setSearch] = useState("");
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [focusSet, setFocusSet] = useState<FocusSet | null>(null);
  const [pathMode, setPathMode] = useState(false);
  const [pathSource, setPathSource] = useState<GraphNode | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [dims, setDims] = useState({ width: 900, height: 600 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [noEvidenceNote, setNoEvidenceNote] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef2D = useRef<ForceGraphMethods2D<NodeObject2D<GraphNode>, GraphLink> | undefined>(undefined);
  const fgRef3D = useRef<ForceGraphMethods3D<NodeObject3D<GraphNode>, GraphLink> | undefined>(undefined);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Filter by visible node types, per legend toggle behavior.
  const filteredNodes = useMemo(() => nodes.filter((n) => visibleTypes.has(n.type)), [nodes, visibleTypes]);
  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const filteredLinks = useMemo(
    () =>
      links.filter((l) => filteredNodeIds.has(linkEndpointId(l.source)) && filteredNodeIds.has(linkEndpointId(l.target))),
    [links, filteredNodeIds],
  );

  const degreeMap = useMemo(() => {
    const dm = new Map<string, number>();
    for (const link of filteredLinks) {
      const s = linkEndpointId(link.source);
      const t = linkEndpointId(link.target);
      dm.set(s, (dm.get(s) || 0) + 1);
      dm.set(t, (dm.get(t) || 0) + 1);
    }
    return dm;
  }, [filteredLinks]);

  const legendEntries = useMemo((): LegendEntry[] => {
    const counts = new Map<GraphNodeType, number>();
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) || 0) + 1);
    const order: GraphNodeType[] = ["Repository", "Directory", "File", "Issue", "PullRequest", "Decision"];
    return order
      .filter((t) => (counts.get(t) || 0) > 0)
      .map((t) => ({ type: t, color: resolveColor(NODE_COLORS[t]), icon: NODE_ICONS[t], count: counts.get(t) ?? 0 }));
  }, [nodes]);

  const searchMatches = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return new Set(filteredNodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id));
  }, [search, filteredNodes]);

  // Search-driven focus is an adaptation, not a verified source behavior: the reference repo's
  // search only filtered a sidebar file tree. Here, on a search match, we focus/highlight the
  // matching nodes directly in the canvas — a reasonable extension for a graph with no sidebar.
  useEffect(() => {
    if (!searchMatches || searchMatches.size === 0) {
      if (searchMatches && searchMatches.size === 0) setFocusSet({ nodes: new Set(), links: new Set() });
      return;
    }
    const matchLinks = new Set(
      filteredLinks.filter((l) => searchMatches.has(linkEndpointId(l.source)) || searchMatches.has(linkEndpointId(l.target))),
    );
    setFocusSet({ nodes: searchMatches, links: matchLinks });
  }, [searchMatches, filteredLinks]);

  const toggleType = useCallback((type: GraphNodeType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Click-to-focus: highlight the clicked node plus its direct-neighbor subgraph (one BFS hop
  // only), dim everything else. Ported from CodeGraphViewer.tsx's handleFileSelect focus-set logic.
  const focusOnNode = useCallback(
    (node: GraphNode) => {
      const nodesInFocus = new Set<string>([node.id]);
      const linksInFocus = new Set<GraphLink>();
      for (const l of filteredLinks) {
        const s = linkEndpointId(l.source);
        const t = linkEndpointId(l.target);
        if (s === node.id || t === node.id) {
          nodesInFocus.add(s);
          nodesInFocus.add(t);
          linksInFocus.add(l);
        }
      }
      setFocusSet({ nodes: nodesInFocus, links: linksInFocus });
    },
    [filteredLinks],
  );

  // Deep-link support for "View Architecture Impact" (IssueDetail -> /code-graph?highlight=inv:{id}).
  // Runs once per initialFocusNodeId: focuses the target node, selects it (opens the detail panel),
  // and — if it's an Issue/PR with zero EVIDENCE links — surfaces an honest "no files referenced"
  // note instead of fabricating an affected-files list.
  const appliedInitialFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialFocusNodeId || nodes.length === 0) return;
    if (appliedInitialFocusRef.current === initialFocusNodeId) return;
    const target = nodes.find((n) => n.id === initialFocusNodeId);
    if (!target) return;
    appliedInitialFocusRef.current = initialFocusNodeId;
    focusOnNode(target);
    setSelectedNode(target);
    if (target.type === "Issue" || target.type === "PullRequest") {
      const hasEvidence = links.some((l) => l.type === "EVIDENCE" && linkEndpointId(l.source) === target.id);
      setNoEvidenceNote(
        hasEvidence
          ? null
          : "This investigation has no matched files — its evidence didn't include a reference the backend could match to a real file path.",
      );
    }
  }, [initialFocusNodeId, nodes, links, focusOnNode]);

  // Plain unweighted BFS over an undirected adjacency built from the currently visible links.
  // Ported from CodeGraphViewer.tsx's calculatePath.
  const runPathfinding = useCallback(
    (source: GraphNode, target: GraphNode) => {
      const adj = new Map<string, Set<string>>();
      for (const link of filteredLinks) {
        const u = linkEndpointId(link.source);
        const v = linkEndpointId(link.target);
        if (!adj.has(u)) adj.set(u, new Set());
        if (!adj.has(v)) adj.set(v, new Set());
        adj.get(u)!.add(v);
        adj.get(v)!.add(u);
      }

      const queue: string[] = [source.id];
      const visited = new Set<string>([source.id]);
      const parent = new Map<string, string>();
      let found = false;

      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === target.id) {
          found = true;
          break;
        }
        for (const next of adj.get(curr) || []) {
          if (!visited.has(next)) {
            visited.add(next);
            parent.set(next, curr);
            queue.push(next);
          }
        }
      }

      if (!found) {
        setPathError("No path found between these nodes.");
        setFocusSet(null);
        return;
      }

      setPathError(null);
      const pathNodeIds = new Set<string>();
      let curr = target.id;
      pathNodeIds.add(curr);
      while (curr !== source.id) {
        const prev = parent.get(curr);
        if (!prev) break;
        pathNodeIds.add(prev);
        curr = prev;
      }

      const pathLinks = new Set(
        filteredLinks.filter((l) => pathNodeIds.has(linkEndpointId(l.source)) && pathNodeIds.has(linkEndpointId(l.target))),
      );
      setFocusSet({ nodes: pathNodeIds, links: pathLinks });
    },
    [filteredLinks],
  );

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (pathMode) {
        if (!pathSource) {
          setPathSource(node);
          setPathError(null);
        } else if (pathSource.id === node.id) {
          setPathSource(null);
        } else {
          runPathfinding(pathSource, node);
          setPathSource(null);
        }
        return;
      }
      focusOnNode(node);
      setSelectedNode(node);
      setNoEvidenceNote(null);
    },
    [pathMode, pathSource, runPathfinding, focusOnNode],
  );

  const closeDetailPanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const togglePathMode = useCallback(() => {
    setPathMode((v) => !v);
    setPathSource(null);
    setPathError(null);
    setFocusSet(null);
    setSelectedNode(null);
  }, []);

  const handleZoomIn = useCallback(() => {
    if (mode === "graph3d") return;
    const fg = fgRef2D.current;
    if (fg) fg.zoom(fg.zoom() * 1.4, 400);
  }, [mode]);

  const handleZoomOut = useCallback(() => {
    if (mode === "graph3d") return;
    const fg = fgRef2D.current;
    if (fg) fg.zoom(fg.zoom() * 0.7, 400);
  }, [mode]);

  const handleFit = useCallback(() => {
    if (mode === "graph3d") {
      fgRef3D.current?.zoomToFit(600, 100);
    } else {
      fgRef2D.current?.zoomToFit(600, 100);
    }
  }, [mode]);

  // ---------------------------------------------------------------------
  // 2D canvas node rendering — classic / galaxy
  // ---------------------------------------------------------------------
  const nodeCanvasObject = useCallback(
    (node: NodeObject2D<GraphNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode & { x?: number; y?: number };
      if (n.x === undefined || n.y === undefined || !Number.isFinite(n.x) || !Number.isFinite(n.y)) return;

      const isHovered = hoverNode?.id === n.id;
      const isFocused = focusSet ? focusSet.nodes.has(n.id) : true;
      const baseColor = resolveColor(NODE_COLORS[n.type]);
      const opacity = isFocused ? (isHovered ? 1 : 0.9) : 0.08;
      const degree = degreeMap.get(n.id) || 0;

      if (mode === "galaxy") {
        const radius = Math.max(3, Math.min(2 + Math.sqrt(degree) * 1.5, 15));
        const ringCount = clamp(degree, 1, 5);
        if (isFocused) {
          const haloRadius = radius * 4;
          const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloRadius);
          grad.addColorStop(0, hexToRgba(baseColor, isHovered ? 0.4 : 0.25));
          grad.addColorStop(0.4, hexToRgba(baseColor, 0.08));
          grad.addColorStop(1, hexToRgba(baseColor, 0));
          ctx.beginPath();
          ctx.arc(n.x, n.y, haloRadius, 0, 2 * Math.PI, false);
          ctx.fillStyle = grad;
          ctx.fill();
          for (let i = 0; i < ringCount; i++) {
            const ringR = radius * (1 + (i + 1) * 0.8);
            const ringAlpha = 0.35 - i * 0.06;
            ctx.beginPath();
            ctx.arc(n.x, n.y, ringR, 0, 2 * Math.PI, false);
            ctx.strokeStyle = hexToRgba(baseColor, Math.max(ringAlpha, 0.05));
            ctx.lineWidth = isHovered ? 0.8 : 0.5;
            ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius * 2, 0, 2 * Math.PI, false);
          ctx.fillStyle = hexToRgba(baseColor, 0.03);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, isFocused ? radius * 0.5 : radius * 0.3, 0, 2 * Math.PI, false);
        ctx.fillStyle = isFocused ? CANVAS_LABEL_INK : hexToRgba(CANVAS_LABEL_INK, opacity * 0.5);
        ctx.fill();
      } else {
        // classic node renderer.
        const baseSize = Math.max(3, Math.min(2 + Math.sqrt(degree) * 1.5, 15));

        if (isHovered) {
          const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, baseSize * 4);
          glow.addColorStop(0, hexToRgba(baseColor, 0.4));
          glow.addColorStop(1, "transparent");
          ctx.beginPath();
          ctx.arc(n.x, n.y, baseSize * 4, 0, 2 * Math.PI, false);
          ctx.fillStyle = glow;
          ctx.fill();
        } else if (isFocused) {
          const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, baseSize * 2.5);
          glow.addColorStop(0, hexToRgba(baseColor, 0.15));
          glow.addColorStop(1, "transparent");
          ctx.beginPath();
          ctx.arc(n.x, n.y, baseSize * 2.5, 0, 2 * Math.PI, false);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, baseSize, 0, 2 * Math.PI, false);
        ctx.fillStyle = isFocused ? hexToRgba(baseColor, 0.85) : hexToRgba(baseColor, 0.15);
        ctx.fill();

        if (isHovered) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2.5 / globalScale;
          ctx.stroke();
        } else if (isFocused) {
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 1.5 / globalScale;
          ctx.stroke();
        }
      }

      const showLabel = isHovered || (isFocused && globalScale > 2);
      if (showLabel) {
        const fontSize = Math.max(2, Math.round((isHovered ? 14 : 10) / globalScale));
        const radiusForLabel = 8;
        const labelY = n.y + radiusForLabel + fontSize / 2 + 4;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isFocused ? CANVAS_LABEL_INK : CANVAS_LABEL_MUTED;
        ctx.font = `${isHovered ? "bold" : "normal"} ${fontSize}px Inter, sans-serif`;
        if (isFocused) {
          ctx.shadowColor = CANVAS_LABEL_SHADOW;
          ctx.shadowBlur = 4;
        }
        ctx.fillText(n.name || "Unknown", n.x, labelY);
        ctx.shadowBlur = 0;
      }
    },
    [hoverNode, focusSet, degreeMap, mode],
  );

  const nodePointerAreaPaint = useCallback(
    (node: NodeObject2D<GraphNode>, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as GraphNode & { x?: number; y?: number };
      if (n.x === undefined || n.y === undefined) return;
      const degree = degreeMap.get(n.id) || 0;
      const hitSize = Math.max(3, Math.min(2 + Math.sqrt(degree) * 1.5, 15));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, hitSize, 0, 2 * Math.PI, false);
      ctx.fill();
    },
    [degreeMap],
  );

  const linkColor = useCallback(
    (link: GraphLink) => {
      const isFocused = focusSet ? focusSet.links.has(link) : true;
      const base = resolveColor(LINK_COLORS[link.type] ?? "var(--border)");
      return isFocused ? base : hexToRgba(base, 0.06);
    },
    [focusSet],
  );

  const linkWidth = useCallback(
    (link: GraphLink) => (focusSet ? (focusSet.links.has(link) ? 2 : 0.5) : 1),
    [focusSet],
  );

  // ---------------------------------------------------------------------
  // 3D object builder — graph3d. Constructed via the local `three` ambient
  // type shim (see three-shim.d.ts) since the `three` package ships no type
  // declarations and adding @types/three would be an undeclared dependency.
  // ---------------------------------------------------------------------

  const graph3dNodeThreeObject = useCallback(
    (node: NodeObject3D<GraphNode>) => {
      const n = node as GraphNode;
      if (!visibleTypes.has(n.type)) return new THREE.Object3D();

      const colorHex = resolveColor(NODE_COLORS[n.type]);
      const degree = degreeMap.get(n.id) || 0;
      const radius = Math.max(1.5, (n.val || 2) * 0.6 + degree * 0.15);

      const sphereGeo = new THREE.SphereGeometry(radius, 16, 12);
      const sphereMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(colorHex),
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.92,
        shininess: 80,
      });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);

      const glowGeo = new THREE.SphereGeometry(radius * 1.4, 16, 12);
      const glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex),
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);

      const group = new THREE.Group();
      group.add(sphere);
      group.add(glow);
      return group;
    },
    [visibleTypes, degreeMap],
  );

  const graph3dLinkColor = useCallback((link: GraphLink) => resolveColor(LINK_COLORS[link.type] ?? "var(--border)"), []);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const graphData = useMemo(() => ({ nodes: filteredNodes, links: filteredLinks }), [filteredNodes, filteredLinks]);

  const pathHint = pathError
    ? pathError
    : pathSource
      ? `Source: ${pathSource.name} — now click a target node.`
      : null;

  return (
    <div className="flex h-full w-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-mono text-sm font-bold uppercase tracking-wide text-ink">{repoName} — Code Graph</h2>
          <p className="text-xs text-muted">
            {filteredNodes.length} nodes &middot; {filteredLinks.length} links
          </p>
        </div>
        <ModeSelector mode={mode} onChange={setMode} />
      </div>

      <GraphControls
        search={search}
        onSearchChange={setSearch}
        pathMode={pathMode}
        onTogglePathMode={togglePathMode}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        pathHint={pathHint}
      />

      {noEvidenceNote && (
        <div className="rounded-xl border border-dashed border-border bg-background px-3 py-2 text-xs font-medium text-muted">
          {noEvidenceNote}
        </div>
      )}

      <div className="flex flex-1 items-stretch gap-3 overflow-hidden">
        <div
          className={`relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border shadow-flat-sm ${
            mode === "mermaid" ? "bg-background" : ""
          }`}
          style={mode === "mermaid" ? undefined : { backgroundColor: CANVAS_BG }}
        >
          <div ref={containerRef} className="h-full w-full">
            {mode === "mermaid" ? (
              <FlowchartView
                nodes={filteredNodes}
                links={filteredLinks}
                nodeColors={NODE_COLORS}
                linkColors={LINK_COLORS}
                width={dims.width}
                height={dims.height}
              />
            ) : mode === "graph3d" ? (
              <ForceGraph3D<GraphNode, GraphLink>
                ref={fgRef3D}
                graphData={graphData}
                width={dims.width}
                height={dims.height}
                backgroundColor={CANVAS_BG}
                nodeThreeObject={graph3dNodeThreeObject}
                nodeThreeObjectExtend={false}
                linkColor={graph3dLinkColor}
                linkOpacity={0.5}
                onNodeClick={(node) => handleNodeClick(node as GraphNode)}
                onNodeHover={(node) => setHoverNode((node as GraphNode | null) ?? null)}
              />
            ) : (
              <ForceGraph2D<GraphNode, GraphLink>
                ref={fgRef2D}
                graphData={graphData}
                width={dims.width}
                height={dims.height}
                backgroundColor={CANVAS_BG}
                nodeCanvasObject={nodeCanvasObject}
                nodePointerAreaPaint={nodePointerAreaPaint}
                linkColor={linkColor}
                linkWidth={linkWidth}
                linkCurvature={0}
                onNodeClick={(node) => handleNodeClick(node as GraphNode)}
                onNodeHover={(node) => setHoverNode((node as GraphNode | null) ?? null)}
                onBackgroundClick={() => {
                  if (!pathMode) {
                    setFocusSet(null);
                    setSelectedNode(null);
                  }
                }}
                cooldownTicks={100}
              />
            )}
          </div>

          <div className="pointer-events-none absolute bottom-3 right-3">
            <div className="pointer-events-auto">
              <GraphLegend entries={legendEntries} visibleTypes={visibleTypes} onToggleType={toggleType} />
            </div>
          </div>
        </div>

        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            nodes={nodes}
            links={links}
            repoName={repoName}
            onClose={closeDetailPanel}
            onAskAboutNode={onAskAboutNode}
          />
        )}
      </div>
    </div>
  );
}
