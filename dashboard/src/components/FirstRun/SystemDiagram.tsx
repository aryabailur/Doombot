import { useReducedMotion } from "framer-motion";

/**
 * The one system diagram used by both the `idle` and `indexing` states of
 * FirstRun (per the design brief: "one diagram, two states"). It is a real
 * technical sketch of Doombot's data flow, not a stock illustration:
 *
 *   REPOSITORY --> ISSUES \
 *               --> CODE    --> AGENT MEMORY --> DECISION --> ACTION
 *               --> HISTORY /
 *
 * `activeStage` drives which nodes read as "lit" (real signal received) vs.
 * dormant. It is undefined on the idle screen (nothing has happened yet —
 * every node sits at the same restrained baseline glow) and 0/1/2 during
 * indexing, matching the two real indexing stages in FirstRun.tsx:
 *   0 = nothing confirmed yet
 *   1 = indexRepo() resolved ("indexing requested" accepted by backend)
 *   2 = getRepoGraph() reported metadata.file_count > 0 (or the poll cap hit)
 */
export type DiagramStage = 0 | 1 | 2;

export interface SystemDiagramProps {
  /** Undefined = idle screen, no stage semantics, gentle ambient pulse only. */
  activeStage?: DiagramStage;
  className?: string;
}

interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Node lights up once real progress reaches at least this stage. */
  litAtStage: DiagramStage;
}

const NODES: DiagramNode[] = [
  { id: "repository", label: "REPOSITORY", x: 210, y: 26, litAtStage: 0 },
  { id: "issues", label: "ISSUES", x: 60, y: 92, litAtStage: 1 },
  { id: "code", label: "CODE", x: 210, y: 92, litAtStage: 1 },
  { id: "history", label: "HISTORY", x: 360, y: 92, litAtStage: 1 },
  { id: "memory", label: "AGENT MEMORY", x: 210, y: 158, litAtStage: 2 },
  { id: "decision", label: "DECISION", x: 210, y: 216, litAtStage: 2 },
  { id: "action", label: "ACTION", x: 210, y: 274, litAtStage: 2 },
];

const EDGES: [string, string][] = [
  ["repository", "issues"],
  ["repository", "code"],
  ["repository", "history"],
  ["issues", "memory"],
  ["code", "memory"],
  ["history", "memory"],
  ["memory", "decision"],
  ["decision", "action"],
];

function nodeById(id: string): DiagramNode {
  const node = NODES.find((n) => n.id === id);
  if (!node) throw new Error(`unknown diagram node: ${id}`);
  return node;
}

export function SystemDiagram({ activeStage, className }: SystemDiagramProps) {
  const prefersReduced = useReducedMotion();
  const interactive = activeStage !== undefined;

  return (
    <svg
      viewBox="0 0 420 300"
      className={className}
      role="img"
      aria-label="Diagram: repository issues, code, and history flow into agent memory, producing a decision and an action"
    >
      <title>Doombot data flow: repository sources feed agent memory, which produces a decision and an action</title>

      {/* Connection lines */}
      <g>
        {EDGES.map(([fromId, toId]) => {
          const from = nodeById(fromId);
          const to = nodeById(toId);
          const targetStage = nodeById(toId).litAtStage;
          const lit = interactive ? (activeStage as number) >= targetStage : false;
          return (
            <g key={`${fromId}-${toId}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--border)"
                strokeWidth={1.5}
              />
              {lit && (
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="var(--success)"
                  strokeWidth={1.5}
                />
              )}
              {!prefersReduced && (
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={lit ? "var(--success)" : "var(--accent)"}
                  strokeWidth={1.5}
                  strokeDasharray="4 10"
                  opacity={0.7}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="14"
                    to="0"
                    dur="1.1s"
                    repeatCount="indefinite"
                  />
                </line>
              )}
            </g>
          );
        })}
      </g>

      {/* Nodes */}
      <g>
        {NODES.map((node) => {
          const lit = interactive ? (activeStage as number) >= node.litAtStage : false;
          const isRoot = node.id === "repository";
          const r = isRoot ? 8 : 6;
          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={lit ? "var(--success)" : interactive ? "var(--card)" : "var(--card)"}
                stroke={lit ? "var(--success)" : "var(--ink)"}
                strokeWidth={1.5}
              />
              {!interactive && !prefersReduced && (
                <circle cx={node.x} cy={node.y} r={r} fill="none" stroke="var(--accent)" strokeWidth={1.5}>
                  <animate
                    attributeName="r"
                    values={`${r};${r + 5};${r}`}
                    dur="2.6s"
                    repeatCount="indefinite"
                    begin={`${NODES.indexOf(node) * 0.25}s`}
                  />
                  <animate
                    attributeName="opacity"
                    values="0.5;0;0.5"
                    dur="2.6s"
                    repeatCount="indefinite"
                    begin={`${NODES.indexOf(node) * 0.25}s`}
                  />
                </circle>
              )}
              {lit && !prefersReduced && (
                <circle cx={node.x} cy={node.y} r={r} fill="none" stroke="var(--success)" strokeWidth={1.5}>
                  <animate attributeName="r" values={`${r};${r + 6};${r}`} dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0;0.6" dur="1.4s" repeatCount="indefinite" />
                </circle>
              )}
              <text
                x={node.x}
                y={node.y + r + 13}
                textAnchor="middle"
                className="font-mono"
                fontSize={8.5}
                fontWeight={700}
                letterSpacing={0.4}
                fill={lit ? "var(--success)" : "var(--muted)"}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
