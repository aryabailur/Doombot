import { useMemo, useState } from "react";
import {
  CircleDot,
  GitPullRequest,
  ScrollText,
  GitCommit,
  ShieldAlert,
  Gauge,
  Copy,
  Tag,
} from "lucide-react";
import type { EvidenceRef, Decision } from "../lib/seed";

export interface EvidenceGraphProps {
  centerLabel: string;
  nodes: EvidenceRef[];
  decision: Decision;
  confidence: number;
  onNodeClick?: (node: EvidenceRef) => void;
}

// Real backend evidence.type -> icon/color/short relationship label. Falls
// back to the coarser `kind` mapping only for entries with no rawType
// (older/demo data), so every distinct evidence type the agent actually
// produces (security keyword match, impact signal, duplicate, label,
// maintainer decision, issue citation, PR precedent) reads as itself
// instead of collapsing into one generic "decision" bucket.
const TYPE_META: Record<string, { icon: typeof CircleDot; color: string; relLabel: string }> = {
  issue: { icon: CircleDot, color: "var(--info)", relLabel: "Similar issue" },
  pr: { icon: GitPullRequest, color: "var(--accent)", relLabel: "Related PR" },
  duplicate: { icon: Copy, color: "var(--info)", relLabel: "Possible duplicate" },
  security: { icon: ShieldAlert, color: "var(--danger)", relLabel: "Security signal" },
  impact: { icon: Gauge, color: "var(--warning)", relLabel: "Impact signal" },
  label: { icon: Tag, color: "var(--muted)", relLabel: "Label rule" },
  decision: { icon: ScrollText, color: "var(--success)", relLabel: "Maintainer decision" },
  commit: { icon: GitCommit, color: "var(--muted)", relLabel: "Recent change" },
};

const KIND_FALLBACK: Record<EvidenceRef["kind"], string> = {
  issue: "issue",
  pr: "pr",
  decision: "decision",
  commit: "commit",
};

function metaFor(node: EvidenceRef) {
  return TYPE_META[node.rawType ?? KIND_FALLBACK[node.kind]] ?? TYPE_META.decision;
}

function nodeLabel(node: EvidenceRef): string {
  if (node.kind === "pr") return `PR #${node.id}`;
  if (node.kind === "commit") return node.id.slice(0, 7);
  if (node.rawType === "security" || node.rawType === "impact" || node.rawType === "label") {
    return node.id.replace(/[-_]/g, " ");
  }
  return `#${node.id}`;
}

const DECISION_COLOR: Record<Decision, string> = {
  escalate: "var(--danger)",
  silent: "var(--success)",
  followup: "var(--warning)",
  duplicate: "var(--info)",
  insufficient: "var(--muted)",
};

const DECISION_COPY: Record<Decision, string> = {
  escalate: "Escalate",
  silent: "Stay silent",
  followup: "Needs information",
  duplicate: "Duplicate",
  insufficient: "Insufficient evidence",
};

const EDGE_STEP_MS = 90;
const NODE_LAG_MS = 200;

export function EvidenceGraph({ centerLabel, nodes: allNodes, decision, confidence, onNodeClick }: EvidenceGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Drop the issue's citation of itself — real data, but not external
  // evidence a maintainer needs to see graphed (same fix applied to
  // AttentionCard's evidence-strip and relevance metric).
  const nodes = useMemo(
    () => allNodes.filter((n) => !(n.kind === "issue" && n.rawType === "issue" && n.id === centerLabel.replace("#", ""))),
    [allNodes, centerLabel]
  );

  // Fan the evidence nodes across their natural row width — a comfortable
  // fixed gap per node, not a rigid even-split across an arbitrary canvas —
  // then size the viewBox to that real content, so the SVG's aspect ratio
  // always matches what's actually drawn instead of stretching a fixed
  // canvas to fill whatever width the card happens to be.
  const NODE_W = 178;
  const MIN_GAP = 20;
  const SIDE_PAD = 40;
  const rowWidth = nodes.length > 0 ? nodes.length * NODE_W + Math.max(0, nodes.length - 1) * MIN_GAP : NODE_W;
  const width = Math.max(rowWidth + SIDE_PAD * 2, 420);
  const cx = width / 2;
  const cy = 56;
  const nodeY = 168;
  const decisionY = 268;
  const height = decisionY + 60;

  const rowStart = cx - rowWidth / 2 + NODE_W / 2;
  const positions = nodes.map((_, i) => rowStart + i * (NODE_W + MIN_GAP));

  const decisionColor = DECISION_COLOR[decision];
  const lastEdgeDelay = Math.max(0, nodes.length - 1) * EDGE_STEP_MS;
  const decisionDelay = lastEdgeDelay + NODE_LAG_MS + 300;

  const activeId = selected ?? hovered;
  const activeNode = nodes.find((n) => n.id === activeId && n.label);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-flat-sm">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mx-auto block"
          style={{ width: "100%", maxWidth: width }}
          role="img"
          aria-label="Evidence graph"
        >
          <defs>
            <filter id="node-shadow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="3" dy="3" stdDeviation="0" floodColor="var(--shadow-color)" floodOpacity="0.9" />
            </filter>
          </defs>

          {nodes.map((node, i) => {
            const nx = positions[i];
            const isDim = activeId !== null && activeId !== node.id;
            return (
              <line
                key={`line-${node.id}`}
                x1={cx}
                y1={cy + 24}
                x2={nx}
                y2={nodeY - 26}
                stroke="var(--border)"
                strokeWidth={1.5}
                opacity={isDim ? 0.35 : 1}
                className="animate-draw-line transition-opacity duration-200"
                style={{ animationDelay: `${120 + i * EDGE_STEP_MS}ms`, animationFillMode: "backwards" }}
              />
            );
          })}
          <line
            x1={cx}
            y1={nodeY + 24}
            x2={cx}
            y2={decisionY - 28}
            stroke="var(--border)"
            strokeWidth={1.5}
            className="animate-draw-line"
            style={{ animationDelay: `${lastEdgeDelay + NODE_LAG_MS}ms`, animationFillMode: "backwards" }}
          />

          {/* center node */}
          <g className="animate-decision-pop" style={{ transformOrigin: `${cx}px ${cy}px` }}>
            <rect x={cx - 74} y={cy - 24} width={148} height={48} rx={10} fill="var(--ink)" filter="url(#node-shadow)" />
            <text x={cx} y={cy + 5} textAnchor="middle" className="font-mono font-bold" style={{ fontSize: 15, fill: "white" }}>
              {centerLabel}
            </text>
          </g>

          {/* evidence nodes */}
          {nodes.map((node, i) => {
            const nx = positions[i];
            const meta = metaFor(node);
            const pct = node.similarity ?? node.relevance ?? node.score;
            const isHovered = hovered === node.id;
            const isSelected = selected === node.id;
            const isDim = activeId !== null && activeId !== node.id;
            const delay = 120 + i * EDGE_STEP_MS + NODE_LAG_MS;
            const label = nodeLabel(node);
            return (
              <g
                key={node.id}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  setSelected((prev) => (prev === node.id ? null : node.id));
                  onNodeClick?.(node);
                }}
                tabIndex={0}
                role="button"
                aria-label={`${label}, ${meta.relLabel}${pct !== undefined ? `, ${Math.round(pct * 100)} percent` : ""}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected((prev) => (prev === node.id ? null : node.id));
                    onNodeClick?.(node);
                  }
                }}
                className="animate-decision-pop cursor-pointer transition-all duration-200 focus:outline-none"
                style={{
                  animationDelay: `${delay}ms`,
                  animationFillMode: "backwards",
                  transformOrigin: `${nx}px ${nodeY}px`,
                  transform: isHovered || isSelected ? "translateY(-3px)" : undefined,
                  opacity: isDim ? 0.4 : 1,
                }}
              >
                {isSelected && (
                  <rect
                    key={`pulse-${node.id}`}
                    x={nx - NODE_W / 2}
                    y={nodeY - 26}
                    width={NODE_W}
                    height={54}
                    rx={10}
                    fill="none"
                    stroke={meta.color}
                    strokeWidth={2}
                    className="animate-evidence-pulse pointer-events-none"
                  />
                )}
                <rect
                  x={nx - NODE_W / 2}
                  y={nodeY - 26}
                  width={NODE_W}
                  height={54}
                  rx={10}
                  fill={isSelected ? meta.color : isHovered ? "var(--background)" : "var(--card)"}
                  stroke={isSelected ? meta.color : "var(--ink)"}
                  strokeWidth={isHovered || isSelected ? 2 : 1.5}
                  filter={isHovered || isSelected ? "url(#node-shadow)" : undefined}
                  className="transition-all duration-200"
                />
                <foreignObject x={nx - NODE_W / 2 + 8} y={nodeY - 20} width={NODE_W - 16} height={20}>
                  <div
                    className="flex items-center gap-1.5 truncate font-mono text-[12px] font-bold leading-tight"
                    style={{ color: isSelected ? "white" : "var(--ink)" }}
                    title={label}
                  >
                    <meta.icon
                      className="h-3 w-3 flex-none"
                      strokeWidth={2.5}
                      style={{ color: isSelected ? "white" : meta.color }}
                    />
                    <span className="truncate capitalize">{label}</span>
                  </div>
                </foreignObject>
                <text
                  x={nx}
                  y={nodeY + 12}
                  textAnchor="middle"
                  className="font-mono font-semibold"
                  style={{ fontSize: 11, fill: isSelected ? "rgba(255,255,255,0.92)" : "var(--ink)" }}
                >
                  {pct !== undefined ? `${Math.round(pct * 100)}% match` : meta.relLabel}
                </text>
                <text
                  x={nx}
                  y={nodeY + 26}
                  textAnchor="middle"
                  className="font-bold uppercase tracking-wide"
                  style={{ fontSize: 8.5, fill: isSelected ? "rgba(255,255,255,0.8)" : "var(--ink)", opacity: isSelected ? 1 : 0.75 }}
                >
                  {meta.relLabel}
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
              x={cx - 96}
              y={decisionY - 26}
              width={192}
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
              {DECISION_COPY[decision]}
            </text>
            <text x={cx} y={decisionY + 14} textAnchor="middle" className="font-mono font-bold" style={{ fontSize: 12, fill: "white" }}>
              {Math.round(confidence * 100)}% confidence
            </text>
          </g>
        </svg>
      </div>

      {nodes.length === 0 && (
        <p className="mt-2 text-center text-sm text-muted">
          No external evidence beyond the issue itself — the decision was made on the issue content alone.
        </p>
      )}

      <div
        className={`mt-4 overflow-hidden transition-all duration-300 ${
          activeNode ? "max-h-32 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {activeNode && (
          <div
            key={activeNode.id}
            className="animate-rise-in rounded-lg border border-border bg-background px-4 py-3"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: metaFor(activeNode).color }}>
              {(() => {
                const Icon = metaFor(activeNode).icon;
                return <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />;
              })()}
              {metaFor(activeNode).relLabel}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink/80">{activeNode.label}</p>
          </div>
        )}
      </div>
    </div>
  );
}
