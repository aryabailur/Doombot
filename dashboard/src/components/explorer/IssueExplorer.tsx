import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquareOff,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from "lucide-react";

import type { IssueGraphNode, IssueGraphResponse } from "@/lib/types";
import { endpointId, linkKey, neighbourhoodOf } from "./analysis";
import { Legend, type LegendEntry } from "./Legend";
import { StatBar } from "./StatBar";
import {
  ACCENT,
  ISSUE_CATEGORY_COLORS,
  ISSUE_CATEGORY_LABELS,
  ISSUE_LINK_COLORS,
  ISSUE_LINK_LABELS,
  PALETTE,
  clamp,
  getRGBA,
  graphAwareNodeScale,
  type VisualizationMode,
} from "./theme";
import {
  ModeMenu,
  Pill,
  ThemeToggle,
  ZoomControls,
  useDragResize,
  useViewportSize,
} from "./chrome";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

/** The modes that mean something for an issue graph: no source, so no city. */
const ISSUE_MODES: VisualizationMode[] = ["classic", "curvy", "neon", "galaxy"];

const MIN_SIDEBAR_W = 200;
const MAX_SIDEBAR_W = 520;
const NARROW_BREAKPOINT = 768;

interface IssueExplorerProps {
  repoName: string;
  graph: IssueGraphResponse | null;
  loading: boolean;
  error: string | null;
  isDark: boolean;
  onToggleTheme: () => void;
  controls?: React.ReactNode;
}

/**
 * The issue relationship explorer.
 *
 * The same immersive chrome as the code explorer, over a different graph: which
 * issues relate and why. Every edge carries its own justification — a cosine
 * score, an explicit `#123` reference, or a shared label — so a maintainer can
 * interrogate a connection instead of trusting the layout, which is the whole
 * point of drawing it.
 */
export function IssueExplorer({
  repoName,
  graph,
  loading,
  error,
  isDark,
  onToggleTheme,
  controls,
}: IssueExplorerProps) {
  const pal = isDark ? PALETTE.dark : PALETTE.light;
  const { width: viewportW, height: viewportH } = useViewportSize();
  const isNarrow = viewportW < NARROW_BREAKPOINT;

  const fgRef = useRef<any>(null);
  const [collapsed, setCollapsed] = useState(isNarrow);
  const [sidebarWidth, onSidebarDrag] = useDragResize(300, MIN_SIDEBAR_W, MAX_SIDEBAR_W, 1);
  const [panelWidth, onPanelDrag] = useDragResize(400, 300, 720, -1);

  const [mode, setMode] = useState<VisualizationMode>("classic");
  const [legendCollapsed, setLegendCollapsed] = useState(viewportW < 1024);
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selected, setSelected] = useState<IssueGraphNode | null>(null);
  const [selectedLinkKey, setSelectedLinkKey] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
    setSelectedLinkKey(null);
    setHoverId(null);
    setSearchQuery("");
    setHiddenCategories(new Set());
  }, [repoName]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph?.nodes ?? []) {
      counts.set(node.category, (counts.get(node.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const data = useMemo(() => {
    const nodes = (graph?.nodes ?? []).filter(
      (node) => !hiddenCategories.has(node.category)
    );
    const ids = new Set(nodes.map((node) => node.id));
    return {
      // Cloned: the simulation mutates its input, adding x/y to every node.
      nodes: nodes.map((node) => ({ ...node })),
      links: (graph?.links ?? [])
        .filter((link) => ids.has(link.source) && ids.has(link.target))
        .map((link) => ({ ...link })),
    };
  }, [graph, hiddenCategories]);

  const focus = useMemo(() => {
    const rootId = selected?.id ?? hoverId;
    if (!rootId) return null;
    return neighbourhoodOf(graph?.links ?? [], rootId);
  }, [selected, hoverId, graph]);

  const nodeScale = useMemo(
    () => graphAwareNodeScale(data.nodes.length),
    [data.nodes.length]
  );

  const unconnected = useMemo(() => {
    const linked = new Set<string>();
    for (const link of data.links) {
      linked.add(endpointId(link.source));
      linked.add(endpointId(link.target));
    }
    return data.nodes.filter((node) => !linked.has(node.id)).length;
  }, [data]);

  /** Everything linked to the selected issue, with the reason for each edge. */
  const relations = useMemo(() => {
    if (!selected || !graph) return [];
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    return graph.links
      .filter((link) => link.source === selected.id || link.target === selected.id)
      .map((link) => {
        const otherId = link.source === selected.id ? link.target : link.source;
        return { other: byId.get(otherId), kind: link.kind, score: link.score, why: link.why };
      })
      .sort((a, b) => b.score - a.score);
  }, [selected, graph]);

  const selectedLink = useMemo(() => {
    if (!selectedLinkKey) return null;
    return (graph?.links ?? []).find((link) => linkKey(link) === selectedLinkKey) ?? null;
  }, [selectedLinkKey, graph]);

  const visibleIssues = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return (graph?.nodes ?? [])
      .filter((node) => !hiddenCategories.has(node.category))
      .filter(
        (node) =>
          needle === "" ||
          node.title.toLowerCase().includes(needle) ||
          String(node.number).includes(needle)
      )
      .sort((a, b) => b.engagement - a.engagement || a.number - b.number);
  }, [graph, hiddenCategories, searchQuery]);

  const paintNode = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = raw as IssueGraphNode & { x?: number; y?: number };
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const x = node.x!;
      const y = node.y!;

      const color = ISSUE_CATEGORY_COLORS[node.category] ?? ISSUE_CATEGORY_COLORS.open;
      const radius =
        (5 + clamp(Math.sqrt(node.engagement) * 1.5, 0, 5)) * nodeScale * 0.5;
      const lit = focus === null || focus.nodes.has(node.id);
      const hovered = hoverId === node.id;
      const isSelected = selected?.id === node.id;

      if (mode === "galaxy" && lit) {
        const halo = radius * 4;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, halo);
        gradient.addColorStop(0, getRGBA(color, 0.3));
        gradient.addColorStop(1, getRGBA(color, 0));
        ctx.beginPath();
        ctx.arc(x, y, halo, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      ctx.save();
      if (mode === "neon") {
        ctx.shadowColor = color;
        ctx.shadowBlur = lit ? 18 : 2;
      }

      // An escalated issue wears a ring: it is the one distinction a maintainer
      // scans this graph for.
      if (node.escalated) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = lit ? color : getRGBA(color, 0.12);
        ctx.lineWidth = 1.4 / globalScale;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = lit ? color : getRGBA(color, 0.12);
      ctx.fill();
      ctx.lineWidth = (isSelected || hovered ? 2.4 : 1.2) / globalScale;
      ctx.strokeStyle =
        isSelected || hovered ? (isDark ? "#ffffff" : "#111111") : getRGBA(color, 0.5);
      ctx.stroke();
      ctx.restore();

      const showLabel = hovered || isSelected || (focus !== null && lit) || globalScale > 1.6;
      if (!showLabel) return;

      const fontSize = Math.max(3, Math.round((hovered ? 13 : 10) / globalScale));
      const label = `#${node.number}`;
      ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labelY = y + radius + fontSize / 2 + 3 / globalScale;
      const textWidth = ctx.measureText(label).width;
      const padding = 3 / globalScale;

      ctx.globalAlpha = lit ? 1 : 0.25;
      ctx.fillStyle = pal.labelPlate;
      ctx.fillRect(
        x - textWidth / 2 - padding,
        labelY - fontSize / 2 - padding / 2,
        textWidth + padding * 2,
        fontSize + padding
      );
      ctx.fillStyle = lit ? pal.nodeLabel : pal.nodeLabelDim;
      ctx.fillText(label, x, labelY);
      ctx.globalAlpha = 1;
    },
    [focus, hoverId, selected, nodeScale, mode, isDark, pal]
  );

  const effectiveSidebarW = collapsed || isNarrow ? 0 : sidebarWidth;
  const panelOpen = selected !== null;
  const effectivePanelW = !panelOpen || isNarrow ? 0 : panelWidth;
  const canvasW = Math.max(240, viewportW - effectiveSidebarW - effectivePanelW);

  const legendEntries: LegendEntry[] = categoryCounts.map(([category, count]) => ({
    id: category,
    label: ISSUE_CATEGORY_LABELS[category] ?? category,
    color: ISSUE_CATEGORY_COLORS[category] ?? ISSUE_CATEGORY_COLORS.open,
    count,
    visible: !hiddenCategories.has(category),
  }));

  function toggleCategory(category: string) {
    setHiddenCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function focusIssue(node: IssueGraphNode) {
    setSelected(node);
    setSelectedLinkKey(null);
    const onCanvas = data.nodes.find((candidate) => candidate.id === node.id) as
      | (IssueGraphNode & { x?: number; y?: number })
      | undefined;
    if (fgRef.current && onCanvas && Number.isFinite(onCanvas.x)) {
      fgRef.current.centerAt?.(onCanvas.x, onCanvas.y, 700);
      fgRef.current.zoom?.(2.2, 700);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex overflow-hidden font-sans"
      style={{ background: pal.bg }}
    >
      <h1 className="sr-only">Issue relationship explorer for {repoName}</h1>

      {!collapsed && isNarrow ? (
        <div
          className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm"
          onClick={() => setCollapsed(true)}
        />
      ) : null}

      <div
        className={`flex h-full flex-none ${isNarrow ? "absolute left-0 top-0 z-[90]" : "relative"}`}
        style={{
          width: collapsed
            ? 0
            : isNarrow
              ? Math.min(sidebarWidth, viewportW * 0.85)
              : sidebarWidth,
          transition: "width 0.2s ease",
        }}
      >
        {!collapsed ? (
          <div
            className="z-[70] flex h-full w-full flex-col overflow-hidden shadow-2xl"
            style={{ background: pal.panelBg, borderRight: `1px solid ${pal.border}` }}
          >
            <div className="flex-none px-4 pb-2 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h2
                  className="flex items-center gap-2 text-sm font-bold uppercase tracking-tight"
                  style={{ color: pal.text }}
                >
                  <Bell className="h-4 w-4" style={{ color: ACCENT }} />
                  Issues
                </h2>
                <button
                  type="button"
                  title="Collapse sidebar"
                  onClick={() => setCollapsed(true)}
                  className="rounded-lg p-1.5"
                  style={{ color: pal.dimText }}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>

              <div className="relative mb-3">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                  style={{ color: pal.dimText }}
                />
                <input
                  type="text"
                  placeholder="Filter by number or title…"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-lg py-1.5 pl-9 pr-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                    border: `1px solid ${pal.border}`,
                    color: pal.text,
                  }}
                />
              </div>

              <div className="mb-1 flex flex-wrap gap-1.5">
                {categoryCounts.map(([category, count]) => {
                  const on = !hiddenCategories.has(category);
                  const color = ISSUE_CATEGORY_COLORS[category] ?? ISSUE_CATEGORY_COLORS.open;
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleCategory(category)}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-opacity"
                      style={{
                        border: `1px solid ${pal.border}`,
                        color: on ? pal.textSecondary : pal.dimText,
                        opacity: on ? 1 : 0.5,
                      }}
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ background: color }}
                      />
                      {ISSUE_CATEGORY_LABELS[category] ?? category} {count}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="custom-scrollbar flex-1 overflow-y-auto px-2 py-1">
              {visibleIssues.length === 0 ? (
                <p className="px-3 py-6 text-xs" style={{ color: pal.dimText }}>
                  {loading ? "Building the graph…" : "No indexed issues match."}
                </p>
              ) : (
                visibleIssues.map((node) => {
                  const color =
                    ISSUE_CATEGORY_COLORS[node.category] ?? ISSUE_CATEGORY_COLORS.open;
                  const isSelected = selected?.id === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => focusIssue(node)}
                      onMouseEnter={() => setHoverId(node.id)}
                      onMouseLeave={() => setHoverId(null)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
                      style={{
                        background: isSelected ? "rgba(168,85,247,0.16)" : "transparent",
                      }}
                    >
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 flex-none rounded-full"
                        style={{ background: color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[12px]"
                          style={{ color: pal.textSecondary }}
                        >
                          <span className="font-mono font-bold">#{node.number}</span>{" "}
                          {node.title}
                        </span>
                        {node.escalated ? (
                          <span
                            className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest"
                            style={{ color: "#ef5350" }}
                          >
                            <AlertTriangle className="h-2.5 w-2.5" /> Escalated
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div
              className="flex flex-none justify-between px-4 py-3 text-[10px] font-black uppercase tracking-widest"
              style={{
                borderTop: `1px solid ${pal.border}`,
                color: pal.dimText,
                background: isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.02)",
              }}
            >
              <span>{data.nodes.length} visible</span>
              <span>{data.links.length} links</span>
            </div>
          </div>
        ) : null}

        {!collapsed && !isNarrow ? (
          <div
            onMouseDown={onSidebarDrag}
            role="separator"
            aria-orientation="vertical"
            className="group absolute right-0 top-0 z-[80] flex h-full w-1 cursor-col-resize items-center justify-center"
          >
            <div
              className="h-full w-0.5 transition-colors group-hover:bg-purple-500/50"
              style={{ background: pal.border }}
            />
          </div>
        ) : null}
      </div>

      {collapsed ? (
        <button
          type="button"
          title="Expand sidebar"
          onClick={() => setCollapsed(false)}
          className="absolute left-0 top-1/2 z-[80] -translate-y-1/2 rounded-r-xl p-2 shadow-2xl"
          style={{
            background: pal.panelBg,
            border: `1px solid ${pal.border}`,
            color: pal.mutedText,
          }}
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : null}

      <div
        className="relative flex-1 overflow-hidden"
        style={{ background: pal.viewportGradient }}
      >
        <div className="absolute right-6 top-6 z-[60] flex flex-wrap items-center justify-end gap-2">
          {controls}
          <ModeMenu
            mode={mode}
            modes={ISSUE_MODES}
            pal={pal}
            isDark={isDark}
            onMode={setMode}
          />
          <ThemeToggle isDark={isDark} pal={pal} onToggle={onToggleTheme} />
        </div>

        <div className="absolute left-6 top-6 z-[60] flex flex-col gap-4">
          <ZoomControls
            pal={pal}
            isDark={isDark}
            disabled={false}
            onZoomIn={() => fgRef.current?.zoom?.(fgRef.current.zoom() * 1.4, 400)}
            onFit={() => fgRef.current?.zoomToFit?.(600, 90)}
            onZoomOut={() => fgRef.current?.zoom?.(fgRef.current.zoom() * 0.7, 400)}
          />
          {selected || selectedLink ? (
            <Pill
              pal={pal}
              onClick={() => {
                setSelected(null);
                setSelectedLinkKey(null);
              }}
            >
              <MessageSquareOff className="h-3.5 w-3.5" />
              Clear focus
            </Pill>
          ) : null}
        </div>

        <div className="pointer-events-none absolute left-1/2 top-20 z-[50] flex w-full -translate-x-1/2 justify-center px-4">
          <StatBar
            loading={loading}
            loadingLabel={`Building ${repoName}'s issue graph`}
            pal={pal}
            isDark={isDark}
            stats={[
              { icon: <Bell />, label: "Issues", value: data.nodes.length },
              { icon: <Copy />, label: "Connections", value: data.links.length },
              {
                icon: <AlertTriangle />,
                label: "Escalated",
                value: data.nodes.filter((node) => node.escalated).length,
              },
            ]}
            warnings={
              graph === null
                ? []
                : [
                    {
                      title: "Unconnected issues",
                      value: unconnected,
                      isWarning: unconnected > 0,
                      hint: "Nothing relates them to anything else in the index — usually the newest issues, or genuinely one-off reports.",
                    },
                  ]
            }
          />
        </div>

        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-sm font-bold" style={{ color: pal.text }}>
              {error}
            </p>
          </div>
        ) : loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: ACCENT }} />
            <p className="text-sm font-bold" style={{ color: pal.text }}>
              Building the graph…
            </p>
          </div>
        ) : data.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-sm font-bold" style={{ color: pal.text }}>
              No indexed issues yet.
            </p>
            <p className="text-xs" style={{ color: pal.mutedText }}>
              Index {repoName} from the sidebar to build this graph.
            </p>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: ACCENT }} />
              </div>
            }
          >
            <ForceGraph2D
              ref={fgRef}
              graphData={data}
              width={canvasW}
              height={viewportH}
              backgroundColor="rgba(0,0,0,0)"
              nodeLabel={() => ""}
              nodeCanvasObject={paintNode}
              linkCurvature={mode === "curvy" ? 0.25 : 0.12}
              linkColor={(raw: object) => {
                const link = raw as { source: unknown; target: unknown; kind: string };
                const base = ISSUE_LINK_COLORS[link.kind] ?? ISSUE_LINK_COLORS.metadata;
                const lit = focus === null || focus.links.has(linkKey(link));
                if (mode === "neon") {
                  return lit ? base : getRGBA(isDark ? "#ffffff" : "#000000", 0.02);
                }
                return lit ? base : getRGBA(isDark ? "#ffffff" : "#000000", 0.05);
              }}
              linkWidth={(raw: object) => {
                const link = raw as { source: unknown; target: unknown; score: number };
                const lit = focus === null || focus.links.has(linkKey(link));
                if (focus) return lit ? 2.6 : 0.4;
                return 0.8 + link.score * 1.4;
              }}
              linkLineDash={(raw: object) =>
                (raw as { kind: string }).kind === "similar" ? [2, 4] : null
              }
              linkDirectionalArrowLength={(raw: object) =>
                (raw as { kind: string }).kind === "reference" ? 4 : 0
              }
              onLinkClick={(raw: object) =>
                setSelectedLinkKey(linkKey(raw as { source: unknown; target: unknown }))
              }
              onNodeClick={(raw: object) => focusIssue(raw as IssueGraphNode)}
              onNodeHover={(raw: object | null) =>
                setHoverId(raw ? (raw as IssueGraphNode).id : null)
              }
              onBackgroundClick={() => {
                setSelected(null);
                setSelectedLinkKey(null);
              }}
              enableNodeDrag
              d3VelocityDecay={0.3}
              cooldownTicks={120}
            />
          </Suspense>
        )}

        <div
          className="pointer-events-none absolute bottom-6 z-[60] flex max-w-xs flex-col items-end gap-3 md:max-w-sm"
          style={{ right: panelOpen && !isNarrow ? panelWidth + 24 : 24 }}
        >
          {/* Clicking a line has to say something, or the edge is decoration. */}
          {selectedLink ? (
            <div
              className="pointer-events-auto rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-3xl"
              style={{ background: pal.overlayBg, borderColor: pal.border }}
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 h-2.5 w-2.5 flex-none rounded-full"
                  style={{
                    background:
                      ISSUE_LINK_COLORS[selectedLink.kind] ?? ISSUE_LINK_COLORS.metadata,
                  }}
                />
                <div className="min-w-0">
                  <p
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: pal.dimText }}
                  >
                    {ISSUE_LINK_LABELS[selectedLink.kind] ?? selectedLink.kind} ·{" "}
                    {(selectedLink.score * 100).toFixed(0)}%
                  </p>
                  <p className="mt-1 text-xs" style={{ color: pal.textSecondary }}>
                    {selectedLink.why}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLinkKey(null)}
                  className="flex-none"
                  style={{ color: pal.dimText }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null}

          {graph !== null ? (
            <Legend
              title="Issue categories"
              entries={legendEntries}
              collapsed={legendCollapsed}
              pal={pal}
              isDark={isDark}
              onToggleCollapsed={() => setLegendCollapsed((value) => !value)}
              onOpenFilters={() => setCollapsed(false)}
              onToggleEntry={toggleCategory}
            />
          ) : null}
        </div>
      </div>

      {panelOpen && selected ? (
        <>
          {isNarrow ? (
            <div
              className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm"
              onClick={() => setSelected(null)}
            />
          ) : null}
          <div
            className="relative z-[90] flex h-full flex-none flex-col overflow-hidden shadow-2xl"
            style={{
              width: isNarrow ? Math.min(panelWidth, viewportW * 0.9) : panelWidth,
              background: pal.panelBg,
              borderLeft: `1px solid ${pal.border}`,
              position: isNarrow ? "absolute" : "relative",
              right: isNarrow ? 0 : undefined,
              top: isNarrow ? 0 : undefined,
            }}
          >
            {!isNarrow ? (
              <div
                onMouseDown={onPanelDrag}
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

            <div
              className="flex flex-none items-start justify-between gap-2 px-4 py-3"
              style={{ borderBottom: `1px solid ${pal.border}` }}
            >
              <div className="min-w-0">
                <p
                  className="font-mono text-[11px] font-bold"
                  style={{ color: ACCENT }}
                >
                  #{selected.number}
                </p>
                <p className="text-[13px] font-bold" style={{ color: pal.text }}>
                  {selected.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex-none rounded-lg p-1.5"
                style={{ color: pal.dimText }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
              <div className="flex flex-wrap gap-2">
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest"
                  style={{
                    background: getRGBA(
                      ISSUE_CATEGORY_COLORS[selected.category] ??
                        ISSUE_CATEGORY_COLORS.open,
                      0.18
                    ),
                    color:
                      ISSUE_CATEGORY_COLORS[selected.category] ??
                      ISSUE_CATEGORY_COLORS.open,
                  }}
                >
                  {ISSUE_CATEGORY_LABELS[selected.category] ?? selected.category}
                </span>
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest"
                  style={{ border: `1px solid ${pal.border}`, color: pal.mutedText }}
                >
                  {selected.state}
                </span>
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest"
                  style={{ border: `1px solid ${pal.border}`, color: pal.mutedText }}
                >
                  {selected.engagement} engagement
                </span>
                {selected.escalated ? (
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest"
                    style={{ background: "rgba(239,83,80,0.18)", color: "#ef5350" }}
                  >
                    Escalated
                  </span>
                ) : null}
              </div>

              {selected.labels.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selected.labels.map((label) => (
                    <span
                      key={label}
                      className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                      style={{
                        background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                        color: pal.mutedText,
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}

              <a
                href={`https://github.com/${repoName}/issues/${selected.number}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest"
                style={{ color: ACCENT }}
              >
                <ExternalLink className="h-3 w-3" /> Open on GitHub
              </a>

              {relations.length > 0 ? (
                <div>
                  <h3
                    className="mb-2 text-[10px] font-black uppercase tracking-widest"
                    style={{ color: pal.dimText }}
                  >
                    Related issues ({relations.length})
                  </h3>
                  <div className="space-y-1.5">
                    {relations.map((relation, index) =>
                      relation.other ? (
                        <button
                          key={`${relation.other.id}:${relation.kind}:${index}`}
                          type="button"
                          onClick={() => focusIssue(relation.other!)}
                          title={relation.why}
                          className="w-full rounded-lg px-2 py-1.5 text-left"
                          style={{
                            background: isDark
                              ? "rgba(255,255,255,0.03)"
                              : "rgba(0,0,0,0.02)",
                          }}
                        >
                          <span
                            className="block truncate text-[11px]"
                            style={{ color: pal.textSecondary }}
                          >
                            <span className="font-mono font-bold">
                              #{relation.other.number}
                            </span>{" "}
                            {relation.other.title}
                          </span>
                          <span
                            className="block text-[9px] uppercase tracking-wider"
                            style={{
                              color:
                                ISSUE_LINK_COLORS[relation.kind] ??
                                ISSUE_LINK_COLORS.metadata,
                            }}
                          >
                            {ISSUE_LINK_LABELS[relation.kind] ?? relation.kind} ·{" "}
                            {(relation.score * 100).toFixed(0)}%
                          </span>
                          <span
                            className="mt-0.5 block text-[9px]"
                            style={{ color: pal.dimText }}
                          >
                            {relation.why}
                          </span>
                        </button>
                      ) : null
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs" style={{ color: pal.dimText }}>
                  Nothing in the index relates to this issue yet.
                </p>
              )}
            </div>

            <div
              className="flex-none px-4 py-2"
              style={{
                borderTop: `1px solid ${pal.border}`,
                background: isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.02)",
              }}
            >
              <Link
                to="/attention"
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: pal.dimText }}
              >
                Open the attention queue →
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
