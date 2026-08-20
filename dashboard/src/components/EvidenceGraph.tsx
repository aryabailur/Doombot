import { useState } from "react";
import type { EvidenceRef, Decision } from "../lib/seed";

export interface EvidenceGraphProps {
  centerLabel: string;
  nodes: EvidenceRef[];
  decision: Decision;
  confidence: number;
  onNodeClick?: (node: EvidenceRef) => void;
}

const RELATIONSHIP_LABEL: Record<EvidenceRef["kind"], string> = {
  issue: "SIMILAR",
  pr: "PRECEDENT",
  decision: "MAINTAINER DECISION",
  commit: "RECENT CHANGE",
};

const DECISION_COLOR: Record<Decision, string> = {
  escalate: "var(--danger)",
  silent: "var(--success)",
  followup: "var(--warning)",
  duplicate: "var(--info)",
  insufficient: "var(--muted)",
};

const EDGE_STEP_MS = 160;
const NODE_LAG_MS = 260;

export function EvidenceGraph({ centerLabel, nodes, decision, confidence, onNodeClick }: EvidenceGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const width = 720;
  const height = 340;
  const cx = width / 2;
  const cy = 70;
  const decisionY = height - 40;
  const nodeY = 190;
  const spacing = width / (nodes.length + 1);
  const decisionColor = DECISION_COLOR[decision];
  const lastEdgeDelay = (nodes.length - 1) * EDGE_STEP_MS;
  const decisionDelay = lastEdgeDelay + NODE_LAG_MS + 350;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
      <svg viewBox={`0 0 ${width} ${height}`} className="mx-auto w-full max-w-3xl" role="img" aria-label="Evidence graph">
        <defs>
          <filter id="node-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="3" dy="3" stdDeviation="0" floodColor="var(--shadow-color)" floodOpacity="0.9" />
          </filter>
        </defs>

        {nodes.map((node, i) => {
          const nx = spacing * (i + 1);
          return (
            <line
              key={`line-${node.id}`}
              x1={cx}
              y1={cy + 24}
              x2={nx}
              y2={nodeY - 24}
              stroke="var(--border)"
              strokeWidth={1.5}
              className="animate-draw-line"
              style={{ animationDelay: `${180 + i * EDGE_STEP_MS}ms`, animationFillMode: "backwards" }}
            />
          );
        })}
        <line
          x1={cx}
          y1={nodeY + 24}
          x2={cx}
          y2={decisionY - 26}
          stroke="var(--border)"
          strokeWidth={1.5}
          className="animate-draw-line"
          style={{ animationDelay: `${lastEdgeDelay + NODE_LAG_MS}ms`, animationFillMode: "backwards" }}
        />

        {/* center node */}
        <g className="animate-decision-pop" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <rect x={cx - 70} y={cy - 24} width={140} height={48} rx={10} fill="var(--ink)" filter="url(#node-shadow)" />
          <text x={cx} y={cy + 5} textAnchor="middle" className="font-mono font-bold" style={{ fontSize: 15, fill: "white" }}>
            {centerLabel}
          </text>
        </g>

        {/* evidence nodes */}
        {nodes.map((node, i) => {
          const nx = spacing * (i + 1);
          const label = node.kind === "pr" ? `PR #${node.id}` : node.kind === "commit" ? node.id.slice(0, 7) : `#${node.id}`;
          const pct = node.similarity ?? node.relevance;
          const isHovered = hovered === node.id;
          const delay = 180 + i * EDGE_STEP_MS + NODE_LAG_MS;
          return (
            <g
              key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onNodeClick?.(node)}
              className="animate-decision-pop transition-transform duration-200"
              style={{
                cursor: onNodeClick ? "pointer" : "default",
                animationDelay: `${delay}ms`,
                animationFillMode: "backwards",
                transformOrigin: `${nx}px ${nodeY}px`,
                transform: isHovered ? "translateY(-3px)" : undefined,
              }}
            >
              <rect
                x={nx - 62}
                y={nodeY - 24}
                width={124}
                height={48}
                rx={10}
                fill={isHovered ? "var(--accent-soft)" : "var(--card)"}
                stroke="var(--ink)"
                strokeWidth={isHovered ? 2 : 1.5}
                filter={isHovered ? "url(#node-shadow)" : undefined}
                className="transition-all duration-200"
              />
              <text x={nx} y={nodeY - 4} textAnchor="middle" className="font-mono font-bold" style={{ fontSize: 13, fill: "var(--ink)" }}>
                {label}
              </text>
              <text x={nx} y={nodeY + 14} textAnchor="middle" className="font-mono" style={{ fontSize: 11, fill: "var(--muted)" }}>
                {pct !== undefined ? `${Math.round(pct * 100)}%` : RELATIONSHIP_LABEL[node.kind]}
              </text>
              <text
                x={nx}
                y={nodeY + 40}
                textAnchor="middle"
                className="font-semibold uppercase tracking-wide"
                style={{ fontSize: 9, fill: "var(--muted)" }}
              >
                {RELATIONSHIP_LABEL[node.kind]}
              </text>
            </g>
          );
        })}

        {/* decision node — arrives last, with a flourish */}
        <g
          className="animate-decision-pop"
          style={{
            transformOrigin: `${cx}px ${decisionY}px`,
            animationDelay: `${decisionDelay}ms`,
            animationFillMode: "backwards",
          }}
        >
          <rect
            x={cx - 90}
            y={decisionY - 26}
            width={180}
            height={52}
            rx={12}
            fill={decisionColor}
            filter="url(#node-shadow)"
          />
          <text
            x={cx}
            y={decisionY - 5}
            textAnchor="middle"
            className="font-bold uppercase tracking-wide"
            style={{ fontSize: 13, fill: "white" }}
          >
            {decision}
          </text>
          <text x={cx} y={decisionY + 14} textAnchor="middle" className="font-mono font-bold" style={{ fontSize: 12, fill: "white" }}>
            {Math.round(confidence * 100)}% confidence
          </text>
        </g>
      </svg>
    </div>
  );
}
