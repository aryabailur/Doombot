import { useMemo, useRef, useState } from "react";

import type { CodeGraphNode } from "@/lib/types";
import { endpointId } from "./analysis";
import type { ExplorerPalette } from "./theme";
import { ACCENT, KIND_LABELS } from "./theme";

const NODE_W = 200;
const NODE_H = 40;
const LEVEL_GAP = 280;
const ROW_GAP = 16;
const SLOT_R = 3.5;

interface FlowchartProps {
  nodes: CodeGraphNode[];
  links: { source: unknown; target: unknown; edge_type: string; why: string }[];
  width: number;
  height: number;
  nodeColors: Record<string, string>;
  edgeColors: Record<string, string>;
  focus: { nodes: Set<string>; links: Set<string> } | null;
  selectedId: string | null;
  pal: ExplorerPalette;
  isDark: boolean;
  onNodeClick: (node: CodeGraphNode) => void;
}

/**
 * Assign each symbol a column by how deep it is in the dependency chain.
 *
 * Longest-path layering, iterated rather than recursed. Cycles are the reason
 * for the pass cap: a genuine dependency cycle has no valid layering, and
 * without a bound this loop would not terminate on the very repositories where
 * the diagram is most useful. Capping settles the cycle members into adjacent
 * columns, which is the honest rendering — a cycle has no "before".
 */
function layerNodes(
  nodes: CodeGraphNode[],
  edges: { source: unknown; target: unknown }[]
): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const level = new Map<string, number>();
  for (const node of nodes) level.set(node.id, 0);

  const pairs = edges
    .map((edge) => [endpointId(edge.source), endpointId(edge.target)] as const)
    .filter(([from, to]) => ids.has(from) && ids.has(to) && from !== to);

  const maxPasses = Math.min(nodes.length, 24);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const [from, to] of pairs) {
      const candidate = level.get(from)! + 1;
      if (candidate > level.get(to)!) {
        level.set(to, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return level;
}

/**
 * The Flowchart visualization mode: a layered SVG diagram instead of a force
 * simulation.
 *
 * Same purpose as the reference viewer's Mermaid mode. A force layout answers
 * "what clusters together"; a layered diagram answers "what calls what, in what
 * order", which is a different question and the one a reader has when they are
 * tracing a request through a codebase. Pan by dragging, zoom on the wheel.
 */
export function FlowchartSvg({
  nodes,
  links,
  width,
  height,
  nodeColors,
  edgeColors,
  focus,
  selectedId,
  pal,
  isDark,
  onNodeClick,
}: FlowchartProps) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const levels = layerNodes(nodes, links);
    const byLevel = new Map<number, CodeGraphNode[]>();
    for (const node of nodes) {
      const level = levels.get(node.id) ?? 0;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level)!.push(node);
    }

    const position = new Map<string, { x: number; y: number }>();
    let maxX = 0;
    let maxY = 0;

    for (const [level, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      // Within a column, the busiest symbols first: the thing everything calls
      // should be findable without scanning.
      group.sort(
        (a, b) =>
          b.in_degree + b.out_degree - (a.in_degree + a.out_degree) ||
          a.qualname.localeCompare(b.qualname)
      );
      group.forEach((node, index) => {
        const x = level * LEVEL_GAP + 40;
        const y = index * (NODE_H + ROW_GAP) + 40;
        position.set(node.id, { x, y });
        maxX = Math.max(maxX, x + NODE_W);
        maxY = Math.max(maxY, y + NODE_H);
      });
    }

    return { position, width: maxX + 40, height: maxY + 40 };
  }, [nodes, links]);

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  );

  function onWheel(event: React.WheelEvent) {
    event.preventDefault();
    setView((current) => ({
      ...current,
      scale: Math.min(2.5, Math.max(0.15, current.scale * (event.deltaY < 0 ? 1.12 : 0.89))),
    }));
  }

  return (
    <svg
      width={width}
      height={height}
      onWheel={onWheel}
      onMouseDown={(event) => {
        dragging.current = { x: event.clientX - view.x, y: event.clientY - view.y };
      }}
      onMouseMove={(event) => {
        if (!dragging.current) return;
        setView((current) => ({
          ...current,
          x: event.clientX - dragging.current!.x,
          y: event.clientY - dragging.current!.y,
        }));
      }}
      onMouseUp={() => {
        dragging.current = null;
      }}
      onMouseLeave={() => {
        dragging.current = null;
      }}
      style={{ cursor: dragging.current ? "grabbing" : "grab", display: "block" }}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        {links.map((link, index) => {
          const from = endpointId(link.source);
          const to = endpointId(link.target);
          const start = layout.position.get(from);
          const end = layout.position.get(to);
          if (!start || !end) return null;

          const key = `${from}->${to}`;
          const lit = focus === null || focus.links.has(key);
          const sx = start.x + NODE_W;
          const sy = start.y + NODE_H / 2;
          const tx = end.x;
          const ty = end.y + NODE_H / 2;
          const midX = (sx + tx) / 2;

          return (
            <path
              key={`${key}:${link.edge_type}:${index}`}
              d={`M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`}
              fill="none"
              stroke={edgeColors[link.edge_type] ?? pal.border}
              strokeWidth={lit ? 1.6 : 0.7}
              opacity={lit ? 0.75 : 0.12}
            />
          );
        })}

        {[...layout.position.entries()].map(([id, point]) => {
          const node = nodeById.get(id);
          if (!node) return null;
          const color = nodeColors[node.kind] ?? nodeColors.other;
          const lit = focus === null || focus.nodes.has(id);
          const isSelected = id === selectedId;

          return (
            <g
              key={id}
              transform={`translate(${point.x} ${point.y})`}
              opacity={lit ? 1 : 0.18}
              onClick={() => onNodeClick(node)}
              style={{ cursor: "pointer" }}
            >
              {isSelected ? (
                <rect
                  x={-3}
                  y={-3}
                  width={NODE_W + 6}
                  height={NODE_H + 6}
                  rx={10}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={2}
                />
              ) : null}
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={isDark ? "#101014" : "#ffffff"}
                stroke={color}
                strokeWidth={1.2}
              />
              <rect width={4} height={NODE_H} rx={2} fill={color} />
              <circle cx={0} cy={NODE_H / 2} r={SLOT_R} fill={color} />
              <circle cx={NODE_W} cy={NODE_H / 2} r={SLOT_R} fill={color} />
              <text
                x={14}
                y={17}
                fontSize={12}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontWeight={600}
                fill={pal.text}
              >
                {node.symbol_name.length > 22
                  ? `${node.symbol_name.slice(0, 21)}…`
                  : node.symbol_name}
              </text>
              <text x={14} y={31} fontSize={9} fill={pal.dimText}>
                {(KIND_LABELS[node.kind] ?? node.kind).toUpperCase()} ·{" "}
                {node.cluster_label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
