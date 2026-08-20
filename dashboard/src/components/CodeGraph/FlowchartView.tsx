import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, GraphLink, GraphNodeType, GraphLinkType } from "./CodeGraphViewer";

const NODE_W = 200;
const NODE_H = 44;
const LEVEL_GAP = 260;
const NODE_GAP = 14;

export interface FlowchartViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  nodeColors: Record<GraphNodeType, string>;
  linkColors: Record<GraphLinkType, string>;
  width: number;
  height: number;
}

interface Position {
  x: number;
  y: number;
}

interface EdgeInfo {
  key: string;
  type: GraphLinkType;
  d: string;
  mx: number;
  my: number;
}

function linkEndpointId(end: GraphLink["source"]): string {
  return typeof end === "object" ? end.id : end;
}

/**
 * Hand-rolled tidy-tree layout, ported from CodeGraphContext's FlowchartSVG.tsx.
 *
 * Algorithm: build a parent/child map from CONTAINS links only (all other link types become
 * cross-links drawn as dashed curves). Recursively compute each subtree's vertical extent
 * (subtreeH), then place nodes left-to-right by depth, centering each subtree vertically around
 * its parent. This is a real recursive layout, not a call into a generic graph-layout library.
 *
 * Simplifications vs. the 664-line source: no drag-to-reposition, no pan/zoom-by-mouse (the
 * container scrolls instead), no orphan grid — RepoGuardian's graph is small enough (repo / dir /
 * file / issue / PR / decision) that a plain scrollable SVG is sufficient and much simpler.
 */
export function FlowchartView({ nodes, links, nodeColors, linkColors, width, height }: FlowchartViewProps) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const { childMap, parentMap, crossLinks } = useMemo(() => {
    const cm = new Map<string, string[]>();
    const pm = new Map<string, string>();
    const cl: { sourceId: string; targetId: string; type: GraphLinkType }[] = [];
    for (const link of links) {
      const s = linkEndpointId(link.source);
      const t = linkEndpointId(link.target);
      if (link.type === "CONTAINS") {
        if (!cm.has(s)) cm.set(s, []);
        cm.get(s)!.push(t);
        pm.set(t, s);
      } else {
        cl.push({ sourceId: s, targetId: t, type: link.type });
      }
    }
    return { childMap: cm, parentMap: pm, crossLinks: cl };
  }, [links]);

  const roots = useMemo(
    () => nodes.filter((n) => !parentMap.has(n.id)).map((n) => n.id),
    [nodes, parentMap],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    // Expand everything by default — RepoGuardian graphs are small enough that a fully-open
    // tree reads better than a click-to-reveal one on first paint.
    setExpanded(new Set(nodes.map((n) => n.id)));
  }, [nodes]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const positions = useMemo(() => {
    const subtreeH = (id: string): number => {
      if (!expanded.has(id)) return NODE_H;
      const kids = (childMap.get(id) || []).filter((k) => nodeMap.has(k));
      if (!kids.length) return NODE_H;
      return kids.reduce((sum, k) => sum + subtreeH(k) + NODE_GAP, -NODE_GAP);
    };

    const pos = new Map<string, Position>();
    const place = (id: string, x: number, yCenter: number) => {
      pos.set(id, { x, y: yCenter - NODE_H / 2 });
      if (!expanded.has(id)) return;
      const kids = (childMap.get(id) || []).filter((k) => nodeMap.has(k));
      if (!kids.length) return;
      const total = subtreeH(id);
      let oy = yCenter - total / 2;
      for (const kid of kids) {
        const kh = subtreeH(kid);
        place(kid, x + LEVEL_GAP, oy + kh / 2);
        oy += kh + NODE_GAP;
      }
    };

    const totalH = roots.reduce((sum, r) => sum + subtreeH(r) + NODE_GAP * 3, 0);
    let y = -totalH / 2;
    for (const r of roots) {
      const rh = subtreeH(r);
      place(r, 40, y + rh / 2);
      y += rh + NODE_GAP * 3;
    }
    return pos;
  }, [roots, childMap, nodeMap, expanded]);

  const visibleIds = useMemo(() => {
    const vis = new Set<string>();
    const queue = [...roots];
    while (queue.length) {
      const id = queue.shift()!;
      if (!nodeMap.has(id)) continue;
      vis.add(id);
      if (expanded.has(id)) {
        for (const k of childMap.get(id) || []) queue.push(k);
      }
    }
    return vis;
  }, [roots, expanded, childMap, nodeMap]);

  const edges = useMemo((): EdgeInfo[] => {
    const out: EdgeInfo[] = [];
    for (const id of visibleIds) {
      if (!expanded.has(id)) continue;
      for (const kid of childMap.get(id) || []) {
        if (!visibleIds.has(kid)) continue;
        const sp = positions.get(id);
        const tp = positions.get(kid);
        if (!sp || !tp) continue;
        const sx = sp.x + NODE_W;
        const sy = sp.y + NODE_H / 2;
        const tx = tp.x;
        const ty = tp.y + NODE_H / 2;
        const mx = (sx + tx) / 2;
        out.push({ key: `c-${id}-${kid}`, type: "CONTAINS", d: `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`, mx, my: (sy + ty) / 2 });
      }
    }
    for (const cl of crossLinks) {
      if (!visibleIds.has(cl.sourceId) || !visibleIds.has(cl.targetId)) continue;
      const sp = positions.get(cl.sourceId);
      const tp = positions.get(cl.targetId);
      if (!sp || !tp) continue;
      const sx = sp.x + NODE_W;
      const sy = sp.y + NODE_H / 2;
      const tx = tp.x;
      const ty = tp.y + NODE_H / 2;
      const mx = (sx + tx) / 2;
      out.push({
        key: `x-${cl.sourceId}-${cl.targetId}-${cl.type}`,
        type: cl.type,
        d: `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`,
        mx,
        my: (sy + ty) / 2,
      });
    }
    return out;
  }, [visibleIds, expanded, childMap, crossLinks, positions]);

  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const bounds = useMemo(() => {
    let minX = 0;
    let maxX = width;
    let minY = 0;
    let maxY = height;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x - 40);
      maxX = Math.max(maxX, p.x + NODE_W + 40);
      minY = Math.min(minY, p.y - 40);
      maxY = Math.max(maxY, p.y + NODE_H + 40);
    }
    return { minX, maxX, minY, maxY };
  }, [positions, width, height]);

  const svgRef = useRef<SVGSVGElement>(null);

  return (
    <div className="h-full w-full overflow-auto rounded-2xl border border-border bg-background">
      <svg
        ref={svgRef}
        width={bounds.maxX - bounds.minX}
        height={bounds.maxY - bounds.minY}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`}
        role="img"
        aria-label="Repository containment flowchart"
      >
        {edges.map((edge) => {
          const isHov = edge.key === hoverEdge;
          const isContains = edge.type === "CONTAINS";
          const color = isHov ? "var(--accent)" : isContains ? "var(--border)" : linkColors[edge.type];
          return (
            <g key={edge.key}>
              <path
                d={edge.d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                onMouseEnter={() => setHoverEdge(edge.key)}
                onMouseLeave={() => setHoverEdge(null)}
                className="cursor-pointer"
              >
                <title>{edge.type}</title>
              </path>
              <path
                d={edge.d}
                fill="none"
                stroke={color}
                strokeWidth={isHov ? 2.5 : isContains ? 1.5 : 1.75}
                opacity={isHov ? 1 : isContains ? 0.65 : 0.8}
                strokeLinecap="round"
                strokeDasharray={isContains ? undefined : "6 3"}
                className="pointer-events-none transition-all duration-150"
              />
              {!isContains && isHov && (
                <g className="pointer-events-none">
                  <rect x={edge.mx - 34} y={edge.my - 10} width={68} height={20} rx={5} fill="var(--card)" stroke={color} strokeWidth={1} />
                  <text
                    x={edge.mx}
                    y={edge.my + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="font-mono font-bold"
                    style={{ fontSize: 9, fill: color, letterSpacing: "0.06em" }}
                  >
                    {edge.type}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {Array.from(visibleIds).map((id) => {
          const node = nodeMap.get(id);
          const pos = positions.get(id);
          if (!node || !pos) return null;
          const color = nodeColors[node.type];
          const isHov = id === hoverNode;
          const isExp = expanded.has(id);
          const kids = (childMap.get(id) || []).filter((k) => nodeMap.has(k));
          const hasKids = kids.length > 0;

          return (
            <g
              key={id}
              transform={`translate(${pos.x},${pos.y})`}
              onMouseEnter={() => setHoverNode(id)}
              onMouseLeave={() => setHoverNode(null)}
              className={hasKids ? "cursor-pointer" : "cursor-default"}
              onClick={() => hasKids && toggleExpand(id)}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={isHov ? "var(--accent-soft)" : "var(--card)"}
                stroke={color}
                strokeWidth={isHov ? 2 : 1.5}
                filter={isHov ? "url(#flowchart-node-shadow)" : undefined}
              />
              <circle cx={0} cy={NODE_H / 2} r={3.5} fill={color} opacity={0.6} />
              <circle cx={NODE_W} cy={NODE_H / 2} r={3.5} fill={color} opacity={0.6} />
              <text x={12} y={18} className="font-mono font-bold" style={{ fontSize: 12, fill: "var(--ink)" }}>
                {node.name.length > 24 ? `${node.name.slice(0, 22)}…` : node.name}
              </text>
              <text
                x={12}
                y={34}
                className="font-bold uppercase"
                style={{ fontSize: 8, fill: color, letterSpacing: "0.08em" }}
              >
                {node.type}
              </text>
              {hasKids && (
                <g>
                  <rect x={NODE_W - 30} y={(NODE_H - 18) / 2} width={24} height={18} rx={4} fill="var(--background)" stroke={color} strokeWidth={0.75} />
                  <text
                    x={NODE_W - 18}
                    y={NODE_H / 2 + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="font-bold"
                    style={{ fontSize: 11, fill: color }}
                  >
                    {isExp ? "−" : `+${kids.length}`}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <defs>
          <filter id="flowchart-node-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="2" dy="2" stdDeviation="0" floodColor="var(--shadow-color)" floodOpacity="0.9" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
