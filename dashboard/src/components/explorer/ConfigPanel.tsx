import { Eye, EyeOff, Palette, SlidersHorizontal } from "lucide-react";

import type { ExplorerPalette, VisualizationMode } from "./theme";
import { ACCENT, EDGE_LABELS, EMOJI_MAP, KIND_LABELS } from "./theme";

interface ConfigPanelProps {
  mode: VisualizationMode;

  nodeSize: number;
  onNodeSize: (value: number) => void;
  lineWidth: number;
  onLineWidth: (value: number) => void;

  /** Symbol kinds present in *this* repository, with counts. */
  kinds: [string, number][];
  nodeColors: Record<string, string>;
  visibleKinds: Set<string>;
  onToggleKind: (kind: string) => void;
  onNodeColor: (kind: string, color: string) => void;

  /** Edge types present in this repository. */
  edgeTypes: [string, number][];
  edgeColors: Record<string, string>;
  onEdgeColor: (edgeType: string, color: string) => void;

  /** Project-shaped filters, which the generic reference does not have. */
  clusters: [string, number][];
  subsystem: string;
  onSubsystem: (value: string) => void;

  runtimes: [string, number][];
  activeRuntimes: Set<string>;
  onToggleRuntime: (runtime: string) => void;

  minDegree: number;
  onMinDegree: (value: number) => void;

  filtersActive: boolean;
  onShowAll: () => void;

  pal: ExplorerPalette;
  isDark: boolean;
}

function SectionHeading({
  children,
  icon,
  pal,
}: {
  children: string;
  icon?: React.ReactNode;
  pal: ExplorerPalette;
}) {
  return (
    <h3
      className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
      style={{ color: pal.dimText }}
    >
      {icon}
      {children}
    </h3>
  );
}

/**
 * The sidebar's settings mode: appearance plus the filters that decide which
 * symbols are on the canvas at all.
 *
 * The reference viewer offers node size, edge width, and a colour-and-visibility
 * row per node type. Those are all here. The four controls below them —
 * subsystem, runtime, minimum connections, and an explicit "show all" — are
 * ours, because our nodes carry a subsystem and a runtime the reference's do
 * not, and because a repository-sized default for the connection floor makes
 * the unfiltered graph unreachable without a reset.
 */
export function ConfigPanel({
  mode,
  nodeSize,
  onNodeSize,
  lineWidth,
  onLineWidth,
  kinds,
  nodeColors,
  visibleKinds,
  onToggleKind,
  onNodeColor,
  edgeTypes,
  edgeColors,
  onEdgeColor,
  clusters,
  subsystem,
  onSubsystem,
  runtimes,
  activeRuntimes,
  onToggleRuntime,
  minDegree,
  onMinDegree,
  filtersActive,
  onShowAll,
  pal,
  isDark,
}: ConfigPanelProps) {
  const inputStyle = {
    background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
    border: `1px solid ${pal.border}`,
    color: pal.text,
  };

  return (
    <div className="animate-rise-in space-y-7 p-3">
      <section>
        <SectionHeading pal={pal} icon={<Palette className="h-3 w-3" />}>
          Visualization config
        </SectionHeading>

        <div className="mb-6 px-1">
          <label
            className="mb-2 block text-[10px] font-bold uppercase tracking-widest"
            style={{ color: pal.mutedText }}
          >
            Node size: {nodeSize.toFixed(1)}x
          </label>
          <input
            type="range"
            min="0.5"
            max="8"
            step="0.1"
            value={nodeSize}
            onChange={(event) => onNodeSize(Number(event.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-lg accent-purple-500"
            style={{ background: pal.border }}
          />
        </div>

        <div className="mb-6 px-1">
          <label
            className="mb-2 block text-[10px] font-bold uppercase tracking-widest"
            style={{ color: pal.mutedText }}
          >
            Edge width: {lineWidth.toFixed(2)}px
          </label>
          <input
            type="range"
            min="0.05"
            max="3"
            step="0.05"
            value={lineWidth}
            onChange={(event) => onLineWidth(Number(event.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-lg accent-purple-500"
            style={{ background: pal.border }}
          />
        </div>

        <div className="space-y-3">
          {kinds.map(([kind, count]) => {
            const visible = visibleKinds.has(kind);
            return (
              <div key={kind} className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onToggleKind(kind)}
                    aria-pressed={visible}
                    title={visible ? `Hide ${kind}` : `Show ${kind}`}
                    className="rounded p-1 transition-colors"
                    style={{
                      color: visible ? ACCENT : pal.dimText,
                      background: visible ? "rgba(168,85,247,0.12)" : "transparent",
                    }}
                  >
                    {visible ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </button>
                  {mode === "icon" ? (
                    <span className="text-[16px]">{EMOJI_MAP[kind] ?? "❓"}</span>
                  ) : null}
                  <span
                    className="truncate text-sm"
                    style={{ color: visible ? pal.textSecondary : pal.dimText }}
                  >
                    {KIND_LABELS[kind] ?? kind}
                  </span>
                  <span
                    className="flex-none font-mono text-[10px]"
                    style={{ color: pal.dimText }}
                  >
                    {count}
                  </span>
                </div>
                <input
                  type="color"
                  aria-label={`${kind} colour`}
                  value={nodeColors[kind] ?? "#78909c"}
                  onChange={(event) => onNodeColor(kind, event.target.value)}
                  className="h-6 w-6 flex-none cursor-pointer overflow-hidden rounded border-none bg-transparent p-0"
                />
              </div>
            );
          })}
        </div>
      </section>

      {edgeTypes.length > 0 ? (
        <section>
          <SectionHeading pal={pal}>Dependency colours</SectionHeading>
          <div className="space-y-3">
            {edgeTypes.map(([edgeType, count]) => (
              <div key={edgeType} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: pal.mutedText }}>
                  {EDGE_LABELS[edgeType] ?? edgeType}
                  <span className="ml-2 font-mono text-[10px]" style={{ color: pal.dimText }}>
                    {count}
                  </span>
                </span>
                <input
                  type="color"
                  aria-label={`${edgeType} colour`}
                  value={edgeColors[edgeType] ?? "#ffffff"}
                  onChange={(event) => onEdgeColor(edgeType, event.target.value)}
                  className="h-6 w-6 cursor-pointer border-none bg-transparent p-0"
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeading pal={pal} icon={<SlidersHorizontal className="h-3 w-3" />}>
          Structure filters
        </SectionHeading>

        <label
          className="mb-2 block text-[10px] font-bold uppercase tracking-widest"
          style={{ color: pal.mutedText }}
        >
          Subsystem
        </label>
        <select
          value={subsystem}
          onChange={(event) => onSubsystem(event.target.value)}
          className="mb-5 w-full rounded-lg px-2.5 py-2 text-xs font-bold focus:outline-none"
          style={inputStyle}
        >
          <option value="">All subsystems</option>
          {clusters.map(([cluster, count]) => (
            <option key={cluster} value={cluster}>
              {cluster} ({count})
            </option>
          ))}
        </select>

        {/* Runtime, only when it varies. Every symbol in express is "shared",
            so a control with a single option would be furniture. */}
        {runtimes.length > 1 ? (
          <>
            <label
              className="mb-2 block text-[10px] font-bold uppercase tracking-widest"
              style={{ color: pal.mutedText }}
            >
              Runtime
            </label>
            <div className="mb-5 flex flex-wrap gap-1.5">
              {runtimes.map(([runtime, count]) => {
                const on = activeRuntimes.has(runtime);
                return (
                  <button
                    key={runtime}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggleRuntime(runtime)}
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors"
                    style={{
                      background: on ? ACCENT : "transparent",
                      border: `1px solid ${on ? ACCENT : pal.border}`,
                      color: on ? "#ffffff" : pal.mutedText,
                    }}
                  >
                    {runtime} {count}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <label
          className="mb-2 block text-[10px] font-bold uppercase tracking-widest"
          style={{ color: pal.mutedText }}
        >
          Min connections: {minDegree}
        </label>
        <input
          type="range"
          min={0}
          max={10}
          value={minDegree}
          onChange={(event) => onMinDegree(Number(event.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded-lg accent-purple-500"
          style={{ background: pal.border }}
        />

        {filtersActive ? (
          <button
            type="button"
            onClick={onShowAll}
            className="mt-4 w-full rounded-lg py-2 text-[11px] font-bold uppercase tracking-widest transition-colors"
            style={{ border: `1px solid ${pal.border}`, color: pal.mutedText }}
          >
            Show all
          </button>
        ) : null}
      </section>
    </div>
  );
}
