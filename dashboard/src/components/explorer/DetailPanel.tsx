import { useEffect, useRef } from "react";
import { ArrowDownLeft, ArrowUpRight, Code2, Loader2, X } from "lucide-react";

import type { CodeGraphNodeApi } from "../../lib/types";
import type { ExplorerPalette, VisualizationMode } from "./theme";
import { ACCENT, EMOJI_MAP, KIND_LABELS } from "./theme";
import { edgeLabel, type SymbolSummary } from "./summary";

export type DetailTab = "code" | "entities" | "architecture";

interface DetailPanelProps {
  width: number;
  isNarrow: boolean;

  filePath: string | null;
  selectedNode: CodeGraphNodeApi | null;
  entities: CodeGraphNodeApi[];
  summary: SymbolSummary | null;

  code: string | null;
  codeLoading: boolean;
  codeError: string | null;
  codeTruncated: boolean;
  /** Line to scroll to and tint. */
  highlightLine: number | null;
  /** Inclusive line span of the selected symbol, tinted more softly. */
  highlightRange: [number, number] | null;

  tab: DetailTab;
  mode: VisualizationMode;
  nodeColors: Record<string, string>;
  pal: ExplorerPalette;
  isDark: boolean;

  onTab: (tab: DetailTab) => void;
  onClose: () => void;
  onEntityClick: (node: CodeGraphNodeApi) => void;
  onRelationClick: (nodeId: string) => void;
  onDragStart: (event: React.MouseEvent) => void;
}

function TabButton({
  active,
  label,
  pal,
  onClick,
}: {
  active: boolean;
  label: string;
  pal: ExplorerPalette;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors"
      style={{
        color: active ? ACCENT : pal.dimText,
        borderBottom: `2px solid ${active ? ACCENT : "transparent"}`,
      }}
    >
      {label}
    </button>
  );
}

function Block({
  title,
  accent,
  children,
  pal,
  isDark,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
  pal: ExplorerPalette;
  isDark: boolean;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
        border: `1px solid ${pal.border}`,
      }}
    >
      <h3
        className="mb-2 text-[10px] font-black uppercase tracking-widest"
        style={{ color: accent }}
      >
        {title}
      </h3>
      <div className="text-sm leading-relaxed" style={{ color: pal.textSecondary }}>
        {children}
      </div>
    </div>
  );
}

/**
 * The right-hand panel: the file's source, the symbols in it, and what the
 * selected symbol connects to.
 *
 * The Architecture tab is where this diverges most from the reference. Theirs
 * shows three generated paragraphs; ours shows those (derived, not generated —
 * see `summary.ts`) *and* the actual caller and callee lists with the graph's
 * own justification string for each edge, so every claim on this panel can be
 * traced to a specific dependency.
 */
export function DetailPanel({
  width,
  isNarrow,
  filePath,
  selectedNode,
  entities,
  summary,
  code,
  codeLoading,
  codeError,
  codeTruncated,
  highlightLine,
  highlightRange,
  tab,
  mode,
  nodeColors,
  pal,
  isDark,
  onTab,
  onClose,
  onEntityClick,
  onRelationClick,
  onDragStart,
}: DetailPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Scroll the highlighted line into view once the source has actually
  // rendered. Without the frame delay the row does not exist yet.
  useEffect(() => {
    if (highlightLine === null || code === null || tab !== "code") return;
    const timer = window.setTimeout(() => {
      bodyRef.current
        ?.querySelector(`[data-line="${highlightLine}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [highlightLine, code, tab]);

  const title = selectedNode
    ? selectedNode.symbol_name
    : filePath
      ? (filePath.split("/").pop() ?? filePath)
      : "Details";

  const lines = code === null ? [] : code.split("\n");

  return (
    <div
      className="relative z-[90] flex h-full flex-none overflow-hidden shadow-2xl"
      style={{
        width,
        background: pal.panelBg,
        borderLeft: `1px solid ${pal.border}`,
        position: isNarrow ? "absolute" : "relative",
        right: isNarrow ? 0 : undefined,
        top: isNarrow ? 0 : undefined,
      }}
    >
      {!isNarrow ? (
        <div
          onMouseDown={onDragStart}
          role="separator"
          aria-orientation="vertical"
          className="group absolute left-0 top-0 z-[80] flex h-full w-1 cursor-col-resize items-center justify-center"
        >
          <div
            className="h-full w-0.5 transition-colors group-hover:bg-purple-500/50"
            style={{ background: pal.border }}
          />
        </div>
      ) : null}

      <div className="flex w-full flex-col overflow-hidden">
        <div
          className="flex flex-none items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${pal.border}` }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Code2 className="h-4 w-4 flex-none" style={{ color: ACCENT }} />
            <span
              className="truncate font-mono text-[13px] font-bold"
              style={{ color: pal.text }}
            >
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close panel"
            className="flex-none rounded-lg p-1.5 transition-colors"
            style={{ color: pal.dimText }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="flex flex-none items-center gap-0 px-4 font-mono text-[10px]"
          style={{ borderBottom: `1px solid ${pal.border}` }}
        >
          <span className="flex-1 truncate py-1.5" style={{ color: pal.dimText }}>
            {filePath ?? selectedNode?.qualname ?? ""}
          </span>
          <div className="ml-2 flex flex-none">
            <TabButton
              active={tab === "code"}
              label="Code"
              pal={pal}
              onClick={() => onTab("code")}
            />
            <TabButton
              active={tab === "entities"}
              label="Entities"
              pal={pal}
              onClick={() => onTab("entities")}
            />
            <TabButton
              active={tab === "architecture"}
              label="Architecture"
              pal={pal}
              onClick={() => onTab("architecture")}
            />
          </div>
        </div>

        <div ref={bodyRef} className="custom-scrollbar flex-1 overflow-auto">
          {tab === "code" ? (
            codeLoading ? (
              <div
                className="flex h-40 flex-col items-center justify-center gap-2 text-[12px]"
                style={{ color: pal.dimText }}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Reading {filePath?.split("/").pop()}…
              </div>
            ) : code !== null ? (
              <>
                {codeTruncated ? (
                  <p
                    className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest"
                    style={{
                      background: "rgba(245,158,11,0.12)",
                      color: "#f59e0b",
                    }}
                  >
                    Truncated — this file is too large to render in full
                  </p>
                ) : null}
                <pre
                  className="overflow-x-auto p-4 font-mono text-[12px] leading-[1.65] whitespace-pre"
                  style={{ color: pal.textSecondary }}
                >
                  {lines.map((line, index) => {
                    const lineNumber = index + 1;
                    const isExact = highlightLine === lineNumber;
                    const inRange =
                      highlightRange !== null &&
                      lineNumber >= highlightRange[0] &&
                      lineNumber <= highlightRange[1];
                    return (
                      <div
                        key={lineNumber}
                        data-line={lineNumber}
                        className="flex"
                        style={{
                          background: isExact
                            ? "rgba(250,204,21,0.14)"
                            : inRange
                              ? "rgba(168,85,247,0.09)"
                              : "transparent",
                        }}
                      >
                        <span
                          className="inline-block w-12 flex-none select-none pr-4 text-right"
                          style={{
                            color: isExact ? "#facc15" : pal.dimText,
                            fontWeight: isExact ? 700 : 400,
                          }}
                        >
                          {lineNumber}
                        </span>
                        <span>{line || " "}</span>
                      </div>
                    );
                  })}
                </pre>
              </>
            ) : (
              <div
                className="flex h-40 items-center justify-center px-6 text-center text-[12px]"
                style={{ color: pal.dimText }}
              >
                {codeError ?? "No source available for this file."}
              </div>
            )
          ) : tab === "entities" ? (
            <div className="p-4">
              {entities.length === 0 ? (
                <p
                  className="flex h-32 items-center justify-center text-center text-xs"
                  style={{ color: pal.dimText }}
                >
                  The parser found no symbols in this file.
                </p>
              ) : (
                <div className="space-y-1">
                  {entities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => onEntityClick(entity)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
                      style={{
                        background:
                          entity.id === selectedNode?.id
                            ? "rgba(168,85,247,0.14)"
                            : "transparent",
                      }}
                    >
                      {mode === "icon" ? (
                        <span className="flex-none text-[14px]">
                          {EMOJI_MAP[entity.kind] ?? "❓"}
                        </span>
                      ) : (
                        <span
                          aria-hidden
                          className="h-2 w-2 flex-none rounded-full"
                          style={{
                            backgroundColor:
                              nodeColors[entity.kind] ?? nodeColors.other,
                          }}
                        />
                      )}
                      <span
                        className="truncate font-mono text-[12px] font-medium"
                        style={{ color: pal.textSecondary }}
                      >
                        {entity.symbol_name}
                      </span>
                      <span className="ml-auto flex flex-none items-center gap-1.5">
                        {entity.in_degree + entity.out_degree > 0 ? (
                          <span
                            className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold"
                            style={{
                              background: "rgba(168,85,247,0.14)",
                              color: ACCENT,
                            }}
                          >
                            {entity.in_degree}↓{entity.out_degree}↑
                          </span>
                        ) : null}
                        <span
                          className="text-[9px] uppercase tracking-wider"
                          style={{ color: pal.dimText }}
                        >
                          {KIND_LABELS[entity.kind] ?? entity.kind}:
                          {entity.start_line}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {!selectedNode || !summary ? (
                <p
                  className="flex h-40 items-center justify-center px-6 text-center text-xs"
                  style={{ color: pal.dimText }}
                >
                  Select a symbol on the canvas, or in the Entities tab, to see
                  what depends on it.
                </p>
              ) : (
                <>
                  <Block title="Component role" accent={ACCENT} pal={pal} isDark={isDark}>
                    {summary.role}
                  </Block>
                  <Block title="Architecture position" accent="#42a5f5" pal={pal} isDark={isDark}>
                    {summary.position}
                  </Block>
                  <Block title="Dependency impact" accent="#f59e0b" pal={pal} isDark={isDark}>
                    {summary.impact}
                    <div
                      className="mt-3 flex gap-6 border-t pt-3"
                      style={{ borderColor: pal.border }}
                    >
                      <div>
                        <span
                          className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: pal.dimText }}
                        >
                          Incoming
                        </span>
                        <span className="font-mono text-sm" style={{ color: pal.text }}>
                          {selectedNode.in_degree}
                        </span>
                      </div>
                      <div>
                        <span
                          className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: pal.dimText }}
                        >
                          Outgoing
                        </span>
                        <span className="font-mono text-sm" style={{ color: pal.text }}>
                          {selectedNode.out_degree}
                        </span>
                      </div>
                      <div>
                        <span
                          className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: pal.dimText }}
                        >
                          Hub score
                        </span>
                        <span className="font-mono text-sm" style={{ color: pal.text }}>
                          {selectedNode.hub_score.toFixed(3)}
                        </span>
                      </div>
                    </div>
                  </Block>

                  {/* Every edge names its own reason. An edge a maintainer
                      cannot interrogate is decoration, not evidence. */}
                  {(
                    [
                      ["Depended on by", summary.callers, <ArrowDownLeft key="i" className="h-3 w-3" />],
                      ["Depends on", summary.callees, <ArrowUpRight key="o" className="h-3 w-3" />],
                    ] as const
                  ).map(([label, relations, icon]) =>
                    relations.length === 0 ? null : (
                      <div key={label}>
                        <h3
                          className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
                          style={{ color: pal.dimText }}
                        >
                          {icon}
                          {label} ({relations.length})
                        </h3>
                        <div className="space-y-1">
                          {relations.map((relation) => (
                            <button
                              key={`${relation.id}:${relation.edgeType}`}
                              type="button"
                              onClick={() => onRelationClick(relation.id)}
                              title={relation.why}
                              className="w-full rounded-lg px-2 py-1.5 text-left transition-colors"
                              style={{ background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)" }}
                            >
                              <span
                                className="block truncate font-mono text-[11px]"
                                style={{ color: pal.textSecondary }}
                              >
                                {relation.label}
                              </span>
                              <span
                                className="block truncate text-[9px] uppercase tracking-wider"
                                style={{ color: pal.dimText }}
                              >
                                {edgeLabel(relation.edgeType)} · {relation.filePath}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div
          className="flex-none px-4 py-2 text-[10px] font-black uppercase tracking-widest"
          style={{
            borderTop: `1px solid ${pal.border}`,
            color: pal.dimText,
            background: isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.02)",
          }}
        >
          {entities.length} {entities.length === 1 ? "entity" : "entities"}
          {code !== null ? ` · ${lines.length} lines` : ""}
        </div>
      </div>
    </div>
  );
}
