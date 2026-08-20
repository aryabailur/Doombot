import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FileCode,
  Loader2,
  MessageSquareOff,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Search,
  Settings2,
} from "lucide-react";

import type { CodeGraphNodeApi, CodeGraphResponseApi } from "../../lib/types";
import { getSourceFile } from "../../lib/api";
import {
  countHubs,
  countOrphans,
  countSelfLoops,
  endpointId,
  findCycles,
  linkKey,
  neighbourhoodOf,
  shortestPath,
} from "./analysis";
import { ConfigPanel } from "./ConfigPanel";
import { DetailPanel, type DetailTab } from "./DetailPanel";
import { FlowchartSvg } from "./FlowchartSvg";
import { Legend, type LegendEntry } from "./Legend";
import { PathPanel } from "./PathPanel";
import { StatBar, STAT_ICONS } from "./StatBar";
import { summariseSymbol } from "./summary";
import { TreeItem } from "./FileTree";
import { buildTree, collapseSingleChildDirs } from "./tree";
import {
  ACCENT,
  EDGE_COLORS,
  EMOJI_MAP,
  KIND_LABELS,
  NODE_COLORS,
  PALETTE,
  clamp,
  getRGBA,
  graphAwareNodeScale,
  is3D,
  type VisualizationMode,
} from "./theme";
import {
  ModeMenu,
  NavigationHints,
  Pill,
  ThemeToggle,
  ZoomControls,
  useDragResize,
  useViewportSize,
} from "./chrome";

/**
 * Both graph renderers touch `window` at module scope and are by far the
 * heaviest dependencies in the dashboard, so neither is statically imported.
 * The 3D bundle additionally pulls in `three`; splitting it separately means
 * the six 2D modes never load it.
 */
const ForceGraph2D = lazy(() => import("react-force-graph-2d"));
const Graph3D = lazy(() => import("./Graph3D"));

const MIN_SIDEBAR_W = 200;
const MAX_SIDEBAR_W = 520;
const DEFAULT_SIDEBAR_W = 300;
const NARROW_BREAKPOINT = 768;
const RECENT_SEARCH_KEY = "repoguardian.explorer.recentSearches";

type SidebarMode = "tree" | "config" | "path";

interface CodeExplorerProps {
  repoName: string;
  graph: CodeGraphResponseApi | null;
  loading: boolean;
  error: string | null;
  isDark: boolean;
  onToggleTheme: () => void;
  /** Rendered into the top-right control bar, left of the mode menu. */
  controls?: React.ReactNode;
}

/**
 * The code structure explorer.
 *
 * A faithful port of CodeGraphContext's viewer (`website/src/components/
 * CodeGraphViewer.tsx`) onto RepoGuardian's own code graph: a full-bleed canvas
 * with a project tree on the left, a source/entities/architecture panel on the
 * right, eight visualization modes, path traversal, and a filter set sized to
 * whatever repository is loaded.
 *
 * The reference's features that depended on its own backend — bundle publishing,
 * the ChatGPT tunnel, and the BYOK LLM query box — are deliberately absent
 * rather than stubbed. A control that cannot do anything is worse than no
 * control, and RepoGuardian's answer to "ask a question about this repository"
 * already exists as the grounded command palette.
 */
export function CodeExplorer({
  repoName,
  graph,
  loading,
  error,
  isDark,
  onToggleTheme,
  controls,
}: CodeExplorerProps) {
  const pal = isDark ? PALETTE.dark : PALETTE.light;
  const { width: viewportW, height: viewportH } = useViewportSize();
  const isNarrow = viewportW < NARROW_BREAKPOINT;

  const fgRef = useRef<any>(null);

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("tree");
  const [collapsed, setCollapsed] = useState(isNarrow);
  const [sidebarWidth, onSidebarDrag] = useDragResize(
    DEFAULT_SIDEBAR_W,
    MIN_SIDEBAR_W,
    MAX_SIDEBAR_W,
    1
  );
  const [panelWidth, onPanelDrag] = useDragResize(440, 300, 820, -1);

  const [mode, setMode] = useState<VisualizationMode>("classic");
  const [nodeSize, setNodeSize] = useState(3);
  const [lineWidth, setLineWidth] = useState(0.24);
  const [legendCollapsed, setLegendCollapsed] = useState(viewportW < 1024);

  const [searchQuery, setSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_SEARCH_KEY);
      return stored ? (JSON.parse(stored) as string[]).slice(0, 6) : [];
    } catch {
      return [];
    }
  });

  const [nodeColors, setNodeColors] = useState<Record<string, string>>(NODE_COLORS);
  const [edgeColors, setEdgeColors] = useState<Record<string, string>>(EDGE_COLORS);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [subsystem, setSubsystem] = useState("");
  const [activeRuntimes, setActiveRuntimes] = useState<Set<string>>(new Set());
  const [minDegree, setMinDegree] = useState(2);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<CodeGraphNodeApi | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [pinnedFocus, setPinnedFocus] = useState<
    { nodes: Set<string>; links: Set<string> } | null
  >(null);

  const [pathSource, setPathSource] = useState<CodeGraphNodeApi | null>(null);
  const [pathTarget, setPathTarget] = useState<CodeGraphNodeApi | null>(null);
  const [pathHops, setPathHops] = useState<number | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  const [detailTab, setDetailTab] = useState<DetailTab>("code");
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeTruncated, setCodeTruncated] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);

  const [owner, repo] = repoName.split("/");

  // ---- reset on repository change ----------------------------------------

  useEffect(() => {
    setSubsystem("");
    setActiveRuntimes(new Set());
    setHiddenKinds(new Set());
    setSelectedNode(null);
    setSelectedFile(null);
    setPinnedFocus(null);
    setHoverId(null);
    setCode(null);
    setCodeError(null);
    setSearchQuery("");
    setPathSource(null);
    setPathTarget(null);
    setPathHops(null);
    setPathError(null);
  }, [repoName]);

  /**
   * Start the connection floor where the graph is legible for *this*
   * repository.
   *
   * A fixed default cannot serve both: 2 is right for a 250-symbol project and
   * useless on yt-dlp, where it still leaves 471 nodes and 1064 edges. Raise
   * the floor until the first render is readable; the slider goes wherever the
   * reader wants from there.
   */
  useEffect(() => {
    if (!graph) return;
    for (const floor of [2, 3, 5, 8]) {
      const kept = graph.nodes.filter(
        (node) => node.in_degree + node.out_degree >= floor
      ).length;
      if (kept <= 320) {
        setMinDegree(floor);
        return;
      }
    }
    setMinDegree(8);
  }, [graph]);

  // ---- facets -------------------------------------------------------------

  const facets = useMemo(() => {
    const kinds = new Map<string, number>();
    const clusters = new Map<string, number>();
    const runtimes = new Map<string, number>();
    for (const node of graph?.nodes ?? []) {
      kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
      clusters.set(node.cluster_label, (clusters.get(node.cluster_label) ?? 0) + 1);
      runtimes.set(node.runtime, (runtimes.get(node.runtime) ?? 0) + 1);
    }
    const edgeTypes = new Map<string, number>();
    for (const link of graph?.links ?? []) {
      edgeTypes.set(link.edge_type, (edgeTypes.get(link.edge_type) ?? 0) + 1);
    }
    const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1];
    return {
      kinds: [...kinds.entries()].sort(byCount),
      clusters: [...clusters.entries()].sort(byCount),
      runtimes: [...runtimes.entries()].sort(byCount),
      edgeTypes: [...edgeTypes.entries()].sort(byCount),
    };
  }, [graph]);

  // ---- filtered graph -----------------------------------------------------

  const data = useMemo(() => {
    const nodes = (graph?.nodes ?? []).filter((node) => {
      if (hiddenKinds.has(node.kind)) return false;
      if (subsystem && node.cluster_label !== subsystem) return false;
      // An empty runtime set means "no restriction" rather than "hide
      // everything", so the filters start open.
      if (activeRuntimes.size > 0 && !activeRuntimes.has(node.runtime)) return false;
      if (minDegree > 0 && node.in_degree + node.out_degree < minDegree) return false;
      return true;
    });
    const ids = new Set(nodes.map((node) => node.id));

    // Server positions seed the layout; they do not pin it. Pinning with fx/fy
    // made the first version a static picture — nothing settled, nothing could
    // be dragged. Seeding converges in about a second and still behaves like a
    // real force graph.
    const scale = 18;
    return {
      nodes: nodes.map((node) => ({
        ...node,
        x: node.x2d * scale,
        y: node.y2d * scale,
      })),
      links: (graph?.links ?? [])
        .filter((link) => ids.has(link.source) && ids.has(link.target))
        .map((link) => ({ ...link })),
    };
  }, [graph, hiddenKinds, subsystem, activeRuntimes, minDegree]);

  const nodeScale = useMemo(
    () => graphAwareNodeScale(data.nodes.length),
    [data.nodes.length]
  );

  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of data.links) {
      const from = endpointId(link.source);
      const to = endpointId(link.target);
      map.set(from, (map.get(from) ?? 0) + 1);
      map.set(to, (map.get(to) ?? 0) + 1);
    }
    return map;
  }, [data.links]);

  /**
   * What is lit on the canvas: a pinned focus (a path, or a clicked file) wins
   * over a transient hover, so a result does not evaporate the moment the
   * pointer moves off the node that produced it.
   */
  const focus = useMemo(() => {
    if (pinnedFocus) return pinnedFocus;
    if (!hoverId) return null;
    return neighbourhoodOf(graph?.links ?? [], hoverId);
  }, [pinnedFocus, hoverId, graph]);

  // ---- structural findings ------------------------------------------------

  const findings = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const links = graph?.links ?? [];
    if (nodes.length === 0) {
      return { cycles: 0, orphans: 0, hubs: 0 };
    }
    const components = findCycles(
      nodes.map((node) => node.id),
      links
    );
    return {
      cycles: components.length + countSelfLoops(links),
      orphans: countOrphans(nodes),
      hubs: countHubs(nodes),
    };
  }, [graph]);

  // ---- file tree ----------------------------------------------------------

  const symbolCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph?.nodes ?? []) {
      counts.set(node.file_path, (counts.get(node.file_path) ?? 0) + 1);
    }
    return counts;
  }, [graph]);

  const fileTree = useMemo(
    () => collapseSingleChildDirs(buildTree(graph?.files ?? [])),
    [graph]
  );

  const entities = useMemo(() => {
    if (!selectedFile) return [];
    return (graph?.nodes ?? [])
      .filter((node) => node.file_path === selectedFile)
      .sort((a, b) => a.start_line - b.start_line);
  }, [graph, selectedFile]);

  const summary = useMemo(() => {
    if (!selectedNode || !graph) return null;
    return summariseSymbol(selectedNode, graph.nodes, graph.links);
  }, [selectedNode, graph]);

  // ---- source loading -----------------------------------------------------

  /** Which file the in-flight source request belongs to, to drop stale replies. */
  const sourceKey = useRef<string | null>(null);

  const loadSource = useCallback(
    (path: string) => {
      if (!owner || !repo) return;
      sourceKey.current = `${owner}/${repo}:${path}`;
      const key = sourceKey.current;
      setCodeLoading(true);
      setCode(null);
      setCodeError(null);
      setCodeTruncated(false);

      getSourceFile(owner, repo, path)
        .then((file) => {
          if (sourceKey.current !== key) return;
          setCode(file.content);
          setCodeTruncated(file.truncated);
        })
        .catch(() => {
          if (sourceKey.current !== key) return;
          setCodeError(`${path} could not be read from GitHub.`);
        })
        .finally(() => {
          if (sourceKey.current !== key) return;
          setCodeLoading(false);
        });
    },
    [owner, repo]
  );

  // ---- interactions -------------------------------------------------------

  const focusFile = useCallback(
    (path: string) => {
      setSelectedFile(path);
      setSelectedNode(null);
      setHighlightLine(null);
      setDetailTab("code");
      loadSource(path);

      // Light every symbol in the file plus everything one hop out, and move
      // the camera to the middle of them.
      const inFile = (graph?.nodes ?? []).filter((node) => node.file_path === path);
      if (inFile.length === 0) {
        setPinnedFocus(null);
        return;
      }
      const ids = new Set(inFile.map((node) => node.id));
      const nodeIds = new Set(ids);
      const links = new Set<string>();
      for (const link of graph?.links ?? []) {
        const from = endpointId(link.source);
        const to = endpointId(link.target);
        if (!ids.has(from) && !ids.has(to)) continue;
        nodeIds.add(from);
        nodeIds.add(to);
        links.add(linkKey(link));
      }
      setPinnedFocus({ nodes: nodeIds, links });

      if (fgRef.current && !is3D(mode)) {
        const onCanvas = data.nodes.filter((node) => ids.has(node.id));
        if (onCanvas.length > 0) {
          const cx =
            onCanvas.reduce((sum, node) => sum + (node.x ?? 0), 0) / onCanvas.length;
          const cy =
            onCanvas.reduce((sum, node) => sum + (node.y ?? 0), 0) / onCanvas.length;
          fgRef.current.centerAt?.(cx, cy, 700);
          fgRef.current.zoom?.(2.2, 700);
        }
      }
    },
    [graph, data.nodes, mode, loadSource]
  );

  const selectSymbol = useCallback(
    (node: CodeGraphNodeApi, options?: { openTab?: DetailTab }) => {
      setSelectedNode(node);
      setPinnedFocus(neighbourhoodOf(graph?.links ?? [], node.id));
      setHighlightLine(node.start_line);
      setDetailTab(options?.openTab ?? "architecture");

      if (node.file_path !== selectedFile) {
        setSelectedFile(node.file_path);
        loadSource(node.file_path);
      }

      if (fgRef.current && !is3D(mode)) {
        const onCanvas = data.nodes.find((candidate) => candidate.id === node.id);
        if (onCanvas) {
          fgRef.current.centerAt?.(onCanvas.x ?? 0, onCanvas.y ?? 0, 700);
        }
      }
    },
    [graph, selectedFile, loadSource, mode, data.nodes]
  );

  const onCanvasNodeClick = useCallback(
    (raw: object) => {
      const node = raw as CodeGraphNodeApi;

      if (sidebarMode === "path") {
        setPathHops(null);
        setPathError(null);
        if (!pathSource) {
          setPathSource(node);
        } else if (!pathTarget) {
          setPathTarget(node);
        } else {
          setPathSource(node);
          setPathTarget(null);
        }
        return;
      }

      selectSymbol(node);
    },
    [sidebarMode, pathSource, pathTarget, selectSymbol]
  );

  const clearSelection = useCallback(() => {
    setSelectedFile(null);
    setSelectedNode(null);
    setPinnedFocus(null);
    setCode(null);
    setCodeError(null);
    setHighlightLine(null);
  }, []);

  const findPath = useCallback(() => {
    if (!pathSource || !pathTarget) return;
    const result = shortestPath(data.links, pathSource.id, pathTarget.id);
    if (!result) {
      setPathError(
        "No path between these two symbols at the current filter. Lower “min connections” and try again."
      );
      setPathHops(null);
      setPinnedFocus(null);
      return;
    }
    setPathError(null);
    setPathHops(result.links.size);
    setPinnedFocus(result);

    if (fgRef.current && !is3D(mode)) {
      const onCanvas = data.nodes.filter((node) => result.nodes.has(node.id));
      if (onCanvas.length > 0) {
        const cx = onCanvas.reduce((sum, node) => sum + (node.x ?? 0), 0) / onCanvas.length;
        const cy = onCanvas.reduce((sum, node) => sum + (node.y ?? 0), 0) / onCanvas.length;
        fgRef.current.centerAt?.(cx, cy, 700);
        fgRef.current.zoom?.(1.6, 700);
      }
    }
  }, [pathSource, pathTarget, data, mode]);

  const rememberSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setRecentSearches((current) => {
      const next = [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, 6);
      try {
        window.localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
      } catch {
        // A blocked localStorage is not worth failing a search over.
      }
      return next;
    });
  }, []);

  // ---- canvas painting ----------------------------------------------------

  const paintNode = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = raw as CodeGraphNodeApi & { x?: number; y?: number };
      const x = node.x;
      const y = node.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const baseColor = nodeColors[node.kind] ?? nodeColors.other;
      const hovered = hoverId === node.id;
      const selected = selectedNode?.id === node.id;
      const lit = focus === null || focus.nodes.has(node.id);
      const massive = data.nodes.length > 3000;
      const degree = degreeMap.get(node.id) ?? 0;
      const radius =
        clamp(3 + Math.sqrt(degree) * 1.5, 3, 15) * nodeSize * nodeScale * 0.34;
      const opacity = lit ? (hovered ? 1 : 0.9) : 0.06;

      // Past a few thousand nodes an arc per node costs more than the frame
      // budget allows; a rect is a tenth of the work and indistinguishable at
      // the zoom level where that many nodes fit on screen.
      if (massive && !lit && !hovered) {
        ctx.fillStyle = getRGBA(baseColor, opacity);
        ctx.fillRect(x! - radius, y! - radius, radius * 2, radius * 2);
        return;
      }

      switch (mode) {
        case "icon": {
          const size = Math.max(14 / globalScale, radius * 2.4);
          if (hovered || selected) {
            ctx.beginPath();
            ctx.arc(x!, y!, size * 0.9, 0, Math.PI * 2);
            ctx.fillStyle = getRGBA(baseColor, 0.22);
            ctx.fill();
          }
          ctx.save();
          ctx.globalAlpha = lit ? 1 : 0.25;
          ctx.font = `${size}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(EMOJI_MAP[node.kind] ?? "❓", x!, y!);
          ctx.restore();
          break;
        }

        case "neon": {
          ctx.save();
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = lit ? 20 : 3;
          ctx.beginPath();
          ctx.arc(x!, y!, radius, 0, Math.PI * 2);
          ctx.fillStyle = lit ? baseColor : getRGBA(baseColor, opacity);
          ctx.fill();
          ctx.shadowBlur = lit ? 10 : 0;
          ctx.beginPath();
          ctx.arc(x!, y!, radius * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = lit
            ? isDark
              ? "rgba(255,255,255,0.9)"
              : "rgba(0,0,0,0.5)"
            : getRGBA(isDark ? "#ffffff" : "#000000", opacity * 0.5);
          ctx.fill();
          ctx.restore();
          break;
        }

        case "galaxy": {
          const rings = clamp(degree, 1, 5);
          if (lit) {
            const halo = radius * 4;
            const gradient = ctx.createRadialGradient(x!, y!, 0, x!, y!, halo);
            gradient.addColorStop(0, getRGBA(baseColor, hovered ? 0.4 : 0.25));
            gradient.addColorStop(0.4, getRGBA(baseColor, 0.08));
            gradient.addColorStop(1, getRGBA(baseColor, 0));
            ctx.beginPath();
            ctx.arc(x!, y!, halo, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();

            for (let i = 0; i < rings; i++) {
              ctx.beginPath();
              ctx.arc(x!, y!, radius * (1 + (i + 1) * 0.8), 0, Math.PI * 2);
              ctx.strokeStyle = getRGBA(baseColor, Math.max(0.35 - i * 0.06, 0.05));
              ctx.lineWidth = (hovered ? 0.8 : 0.5) / globalScale;
              ctx.stroke();
            }
          }
          ctx.beginPath();
          ctx.arc(x!, y!, lit ? radius * 0.5 : radius * 0.3, 0, Math.PI * 2);
          ctx.fillStyle = lit
            ? isDark
              ? "#ffffff"
              : "#1a1a1a"
            : getRGBA(isDark ? "#ffffff" : "#000000", opacity * 0.5);
          ctx.fill();
          break;
        }

        default: {
          if (hovered || selected) {
            const gradient = ctx.createRadialGradient(x!, y!, 0, x!, y!, radius * 4);
            gradient.addColorStop(0, getRGBA(baseColor, 0.4));
            gradient.addColorStop(1, "transparent");
            ctx.beginPath();
            ctx.arc(x!, y!, radius * 4, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
          } else if (lit && !massive) {
            const gradient = ctx.createRadialGradient(x!, y!, 0, x!, y!, radius * 2.5);
            gradient.addColorStop(0, getRGBA(baseColor, 0.15));
            gradient.addColorStop(1, "transparent");
            ctx.beginPath();
            ctx.arc(x!, y!, radius * 2.5, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(x!, y!, radius, 0, Math.PI * 2);
          ctx.fillStyle = lit ? getRGBA(baseColor, 0.85) : getRGBA(baseColor, 0.14);
          ctx.fill();

          if (hovered || selected) {
            ctx.strokeStyle = isDark ? "#ffffff" : "#111111";
            ctx.lineWidth = 2.5 / globalScale;
            ctx.stroke();
          } else if (lit) {
            ctx.strokeStyle = baseColor;
            ctx.lineWidth = 1.5 / globalScale;
            ctx.stroke();
          }
          break;
        }
      }

      /**
       * Labels are the reason a first attempt reads as noise: a hundred symbol
       * names drawn at once overlap into mush and hide the structure they exist
       * to explain. They appear only where they can be read — the hovered or
       * selected node, a lit neighbourhood, or once zoomed past 2x.
       */
      const showLabel =
        hovered || selected || (focus !== null && lit) || globalScale > (massive ? 5 : 2);
      if (!showLabel) return;

      const fontSize = Math.max(2, Math.round((hovered ? 14 : 10) / globalScale));
      const labelY = y! + radius + fontSize / 2 + 3 / globalScale;
      ctx.font = `${hovered || selected ? 700 : 500} ${fontSize}px Inter, ui-sans-serif, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // A plate behind the text, so a label crossing an edge stays legible
      // instead of blending into the line.
      const label = node.symbol_name;
      const textWidth = ctx.measureText(label).width;
      const padding = 3 / globalScale;
      ctx.globalAlpha = lit ? 1 : 0.25;
      ctx.fillStyle = pal.labelPlate;
      ctx.fillRect(
        x! - textWidth / 2 - padding,
        labelY - fontSize / 2 - padding / 2,
        textWidth + padding * 2,
        fontSize + padding
      );

      ctx.fillStyle = lit ? pal.nodeLabel : pal.nodeLabelDim;
      ctx.fillText(label, x!, labelY);
      ctx.globalAlpha = 1;
    },
    [
      nodeColors,
      hoverId,
      selectedNode,
      focus,
      data.nodes.length,
      degreeMap,
      nodeSize,
      nodeScale,
      mode,
      isDark,
      pal,
    ]
  );

  const linkColor = useCallback(
    (raw: object) => {
      const link = raw as { source: unknown; target: unknown; edge_type: string };
      const base = edgeColors[link.edge_type] ?? (isDark ? "#ffffff" : "#333333");
      const lit = focus === null || focus.links.has(linkKey(link));
      if (mode === "galaxy") {
        return lit ? getRGBA(base, 0.25) : getRGBA(isDark ? "#ffffff" : "#000000", 0.03);
      }
      if (mode === "neon") {
        return lit ? base : getRGBA(isDark ? "#ffffff" : "#000000", 0.015);
      }
      return lit ? base : getRGBA(isDark ? "#ffffff" : "#000000", 0.04);
    },
    [edgeColors, focus, mode, isDark]
  );

  const pointerAreaPaint = useCallback(
    (raw: object, color: string, ctx: CanvasRenderingContext2D) => {
      const node = raw as { x?: number; y?: number; id: string };
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const degree = degreeMap.get(node.id) ?? 0;
      // A generous hit area: the visible dot at these scales is a few pixels,
      // and a target you cannot reliably click is not interactive.
      const hit =
        clamp(3 + Math.sqrt(degree) * 1.5, 3, 15) * nodeSize * nodeScale * 0.5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, hit, 0, Math.PI * 2);
      ctx.fill();
    },
    [degreeMap, nodeSize, nodeScale]
  );

  // ---- derived chrome values ---------------------------------------------

  const effectiveSidebarW = collapsed || isNarrow ? 0 : sidebarWidth;
  const panelOpen = selectedFile !== null || selectedNode !== null;
  const effectivePanelW = !panelOpen || isNarrow ? 0 : panelWidth;
  const canvasW = Math.max(240, viewportW - effectiveSidebarW - effectivePanelW);

  const legendEntries: LegendEntry[] = facets.kinds.map(([kind, count]) => ({
    id: kind,
    label: KIND_LABELS[kind] ?? kind,
    color: nodeColors[kind] ?? nodeColors.other,
    count,
    visible: !hiddenKinds.has(kind),
  }));

  const filtersActive =
    subsystem !== "" || activeRuntimes.size > 0 || minDegree > 0 || hiddenKinds.size > 0;

  function toggleKind(kind: string) {
    setHiddenKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function toggleRuntime(runtime: string) {
    setActiveRuntimes((current) => {
      const next = new Set(current);
      if (next.has(runtime)) next.delete(runtime);
      else next.add(runtime);
      return next;
    });
  }

  const sidebarButton = (
    target: SidebarMode,
    label: string,
    icon: React.ReactNode
  ) => (
    <button
      type="button"
      title={label}
      onClick={() => setSidebarMode((current) => (current === target ? "tree" : target))}
      className="rounded-lg p-1.5 transition-colors"
      style={{
        color: sidebarMode === target ? ACCENT : pal.dimText,
        background: sidebarMode === target ? "rgba(168,85,247,0.16)" : "transparent",
      }}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex overflow-hidden font-sans"
      style={{ background: pal.bg }}
    >
      <h1 className="sr-only">Code structure explorer for {repoName}</h1>

      {/* ── SIDEBAR ── */}
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
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2
                  className="flex min-w-0 items-center gap-2 text-sm font-bold uppercase tracking-tight"
                  style={{ color: pal.text }}
                >
                  {sidebarMode === "path" ? (
                    <>
                      <Route className="h-4 w-4 flex-none" style={{ color: ACCENT }} />
                      Path finder
                    </>
                  ) : sidebarMode === "config" ? (
                    <>
                      <Settings2 className="h-4 w-4 flex-none" style={{ color: ACCENT }} />
                      Settings
                    </>
                  ) : (
                    <>
                      <FileCode className="h-4 w-4 flex-none" style={{ color: ACCENT }} />
                      Project tree
                    </>
                  )}
                </h2>
                <div className="flex flex-none items-center gap-1">
                  {sidebarButton("path", "Path finder", <Route className="h-4 w-4" />)}
                  {sidebarButton("config", "Graph settings", <Settings2 className="h-4 w-4" />)}
                  <button
                    type="button"
                    title="Collapse sidebar"
                    onClick={() => setCollapsed(true)}
                    className="rounded-lg p-1.5 transition-colors"
                    style={{ color: pal.dimText }}
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {sidebarMode === "tree" ? (
                <>
                  <div className="relative mb-2">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                      style={{ color: pal.dimText }}
                    />
                    <input
                      type="text"
                      placeholder="Filter files…"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") rememberSearch(searchQuery);
                      }}
                      className="w-full rounded-lg py-1.5 pl-9 pr-3 text-[13px] transition-all focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                      style={{
                        background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                        border: `1px solid ${pal.border}`,
                        color: pal.text,
                      }}
                    />
                  </div>
                  {recentSearches.length > 0 ? (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {recentSearches.map((query) => (
                        <button
                          key={query}
                          type="button"
                          onClick={() => {
                            setSearchQuery(query);
                            rememberSearch(query);
                          }}
                          className="rounded-full px-2 py-0.5 text-[10px] transition-colors"
                          style={{
                            background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                            border: `1px solid ${pal.border}`,
                            color: pal.mutedText,
                          }}
                        >
                          {query}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="custom-scrollbar flex-1 overflow-y-auto px-2 py-1">
              {sidebarMode === "path" ? (
                <PathPanel
                  sourceLabel={pathSource?.qualname ?? null}
                  targetLabel={pathTarget?.qualname ?? null}
                  hops={pathHops}
                  error={pathError}
                  pal={pal}
                  isDark={isDark}
                  onClear={() => {
                    setPathSource(null);
                    setPathTarget(null);
                    setPathHops(null);
                    setPathError(null);
                    setPinnedFocus(null);
                  }}
                  onFindPath={findPath}
                />
              ) : sidebarMode === "config" ? (
                <ConfigPanel
                  mode={mode}
                  nodeSize={nodeSize}
                  onNodeSize={setNodeSize}
                  lineWidth={lineWidth}
                  onLineWidth={setLineWidth}
                  kinds={facets.kinds}
                  nodeColors={nodeColors}
                  visibleKinds={
                    new Set(
                      facets.kinds
                        .map(([kind]) => kind)
                        .filter((kind) => !hiddenKinds.has(kind))
                    )
                  }
                  onToggleKind={toggleKind}
                  onNodeColor={(kind, color) =>
                    setNodeColors((current) => ({ ...current, [kind]: color }))
                  }
                  edgeTypes={facets.edgeTypes}
                  edgeColors={edgeColors}
                  onEdgeColor={(edgeType, color) =>
                    setEdgeColors((current) => ({ ...current, [edgeType]: color }))
                  }
                  clusters={facets.clusters}
                  subsystem={subsystem}
                  onSubsystem={setSubsystem}
                  runtimes={facets.runtimes}
                  activeRuntimes={activeRuntimes}
                  onToggleRuntime={toggleRuntime}
                  minDegree={minDegree}
                  onMinDegree={setMinDegree}
                  filtersActive={filtersActive}
                  onShowAll={() => {
                    setSubsystem("");
                    setActiveRuntimes(new Set());
                    setHiddenKinds(new Set());
                    setMinDegree(0);
                  }}
                  pal={pal}
                  isDark={isDark}
                />
              ) : fileTree.length === 0 ? (
                <p className="px-3 py-6 text-xs" style={{ color: pal.dimText }}>
                  {loading
                    ? "Reading source files…"
                    : "No indexed source files for this repository yet."}
                </p>
              ) : (
                <div className="py-1">
                  {fileTree.map((node) => (
                    <TreeItem
                      key={`${node.path}:${node.isDir}`}
                      node={node}
                      depth={0}
                      selectedFile={selectedFile}
                      symbolCounts={symbolCounts}
                      searchQuery={searchQuery}
                      pal={pal}
                      isDark={isDark}
                      onFileClick={focusFile}
                    />
                  ))}
                </div>
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
              <span>{data.links.length} edges</span>
            </div>
          </div>
        ) : null}

        {!collapsed && !isNarrow ? (
          <div
            onMouseDown={onSidebarDrag}
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize"
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
          className="absolute left-0 top-1/2 z-[80] -translate-y-1/2 rounded-r-xl p-2 shadow-2xl transition-colors"
          style={{
            background: pal.panelBg,
            border: `1px solid ${pal.border}`,
            color: pal.mutedText,
          }}
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : null}

      {/* ── VIEWPORT ── */}
      <div
        className="relative flex-1 overflow-hidden"
        style={{ background: pal.viewportGradient }}
      >
        <div className="absolute right-6 top-6 z-[60] flex flex-wrap items-center justify-end gap-2">
          {controls}
          <ModeMenu mode={mode} pal={pal} isDark={isDark} onMode={setMode} />
          <ThemeToggle isDark={isDark} pal={pal} onToggle={onToggleTheme} />
        </div>

        <div className="absolute left-6 top-6 z-[60] flex flex-col gap-4">
          <ZoomControls
            pal={pal}
            isDark={isDark}
            disabled={is3D(mode) || mode === "flowchart"}
            onZoomIn={() => fgRef.current?.zoom?.(fgRef.current.zoom() * 1.4, 400)}
            onFit={() => fgRef.current?.zoomToFit?.(600, 90)}
            onZoomOut={() => fgRef.current?.zoom?.(fgRef.current.zoom() * 0.7, 400)}
          />
          {panelOpen || pinnedFocus ? (
            <Pill pal={pal} onClick={clearSelection} title="Clear the current focus">
              <MessageSquareOff className="h-3.5 w-3.5" />
              Clear focus
            </Pill>
          ) : null}
        </div>

        <div className="pointer-events-none absolute left-1/2 top-20 z-[50] flex w-full -translate-x-1/2 justify-center px-4">
          <StatBar
            loading={loading}
            loadingLabel={`Reading ${repoName} source`}
            pal={pal}
            isDark={isDark}
            stats={[
              { icon: STAT_ICONS.files, label: "Files", value: graph?.files.length ?? 0 },
              {
                icon: STAT_ICONS.subsystems,
                label: "Subsystems",
                value: graph?.stats.cluster_count ?? 0,
              },
              { icon: STAT_ICONS.symbols, label: "Symbols", value: graph?.nodes.length ?? 0 },
              {
                icon: STAT_ICONS.dependencies,
                label: "Dependencies",
                value: graph?.links.length ?? 0,
              },
            ]}
            warnings={
              graph === null
                ? []
                : [
                    {
                      title: "Dependency cycles",
                      value: findings.cycles,
                      isWarning: findings.cycles > 0,
                      hint: "Strongly connected components of size > 1, plus self-calls. Computed in the browser from this graph's own edges.",
                    },
                    {
                      title: "Unconnected symbols",
                      value: findings.orphans,
                      isWarning: findings.orphans > 0,
                      hint: "Nothing calls them and they call nothing. Often an entry point — or a call the parser could not resolve.",
                    },
                    {
                      title: "Hub symbols",
                      value: findings.hubs,
                      isWarning: findings.hubs > 0,
                      hint: "Eight or more incoming dependencies. A change here ripples furthest.",
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
            <p className="max-w-md text-xs" style={{ color: pal.mutedText }}>
              The code graph reads every source file over the GitHub API. Index{" "}
              {repoName} first, and check the API's rate-limit budget if this
              keeps happening.
            </p>
          </div>
        ) : loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: ACCENT }} />
            <p className="text-sm font-bold" style={{ color: pal.text }}>
              Reading {repoName}'s source…
            </p>
            <p className="max-w-sm text-center text-xs" style={{ color: pal.mutedText }}>
              Each file is a separate GitHub request, so this can take up to a
              minute on a large repository. It is cached afterwards.
            </p>
          </div>
        ) : data.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-sm font-bold" style={{ color: pal.text }}>
              Nothing to show at this filter.
            </p>
            <p className="text-xs" style={{ color: pal.mutedText }}>
              Lower “min connections” in Settings, or clear the subsystem filter.
            </p>
          </div>
        ) : mode === "flowchart" ? (
          <FlowchartSvg
            nodes={data.nodes}
            links={data.links}
            width={canvasW}
            height={viewportH}
            nodeColors={nodeColors}
            edgeColors={edgeColors}
            focus={focus}
            selectedId={selectedNode?.id ?? null}
            pal={pal}
            isDark={isDark}
            onNodeClick={(node) => onCanvasNodeClick(node)}
          />
        ) : is3D(mode) ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: ACCENT }} />
              </div>
            }
          >
            <Graph3D
              mode={mode as "city3d" | "graph3d"}
              nodes={data.nodes}
              links={data.links}
              width={canvasW}
              height={viewportH}
              nodeColors={nodeColors}
              edgeColors={edgeColors}
              nodeSize={nodeSize}
              lineWidth={lineWidth}
              focus={focus}
              isDark={isDark}
              pal={pal}
              onNodeClick={(node) => onCanvasNodeClick(node)}
              onNodeHover={(node) => setHoverId(node?.id ?? null)}
            />
          </Suspense>
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
              // The library tooltip is a floating black box that tracks the
              // cursor directly over the neighbourhood the hover exists to
              // reveal. Everything it would say is in the right-hand panel.
              nodeLabel={() => ""}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={pointerAreaPaint}
              linkCurvature={mode === "curvy" ? 0.25 : 0}
              linkColor={linkColor}
              linkWidth={
                mode === "galaxy" ? 0.7 : mode === "neon" ? lineWidth * 1.2 : lineWidth
              }
              linkDirectionalArrowLength={(raw: object) =>
                focus && focus.links.has(linkKey(raw as never)) ? 4 : 1.8
              }
              linkDirectionalParticles={(raw: object) =>
                mode === "galaxy"
                  ? 0
                  : focus
                    ? focus.links.has(linkKey(raw as never))
                      ? 2
                      : 0
                    : data.links.length > 500
                      ? 0
                      : 1
              }
              linkDirectionalParticleWidth={lineWidth * 1.5}
              linkDirectionalParticleSpeed={0.005}
              onNodeClick={onCanvasNodeClick}
              onNodeHover={(raw: object | null) =>
                setHoverId(raw ? (raw as CodeGraphNodeApi).id : null)
              }
              onBackgroundClick={clearSelection}
              enableNodeDrag
              d3VelocityDecay={0.35}
              d3AlphaDecay={0.05}
              cooldownTicks={80}
            />
          </Suspense>
        )}

        <div
          className="pointer-events-none absolute bottom-6 z-[60] flex max-w-xs flex-col items-end gap-4 md:max-w-sm"
          style={{ right: panelOpen && !isNarrow ? panelWidth + 24 : 24 }}
        >
          {is3D(mode) ? (
            <NavigationHints
              pal={pal}
              isDark={isDark}
              hints={[
                ["Orbit", "Drag"],
                ["Zoom", "Scroll"],
                ["Inspect", mode === "city3d" ? "Click tower" : "Click sphere"],
              ]}
            />
          ) : null}
          {sidebarMode !== "config" && graph !== null ? (
            <Legend
              title="Symbol kinds"
              entries={legendEntries}
              collapsed={legendCollapsed}
              mode={mode}
              pal={pal}
              isDark={isDark}
              onToggleCollapsed={() => setLegendCollapsed((value) => !value)}
              onOpenFilters={() => {
                setSidebarMode("config");
                setCollapsed(false);
              }}
              onToggleEntry={toggleKind}
            />
          ) : null}
        </div>
      </div>

      {/* ── DETAIL PANEL ── */}
      {panelOpen ? (
        <>
          {isNarrow ? (
            <div
              className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm"
              onClick={clearSelection}
            />
          ) : null}
          <DetailPanel
            width={isNarrow ? Math.min(panelWidth, viewportW * 0.9) : panelWidth}
            isNarrow={isNarrow}
            filePath={selectedFile}
            selectedNode={selectedNode}
            entities={entities}
            summary={summary}
            code={code}
            codeLoading={codeLoading}
            codeError={codeError}
            codeTruncated={codeTruncated}
            highlightLine={highlightLine}
            highlightRange={
              selectedNode ? [selectedNode.start_line, selectedNode.end_line] : null
            }
            tab={detailTab}
            mode={mode}
            nodeColors={nodeColors}
            pal={pal}
            isDark={isDark}
            onTab={setDetailTab}
            onClose={clearSelection}
            onEntityClick={(node) => selectSymbol(node, { openTab: "code" })}
            onRelationClick={(nodeId) => {
              const target = graph?.nodes.find((node) => node.id === nodeId);
              if (target) selectSymbol(target);
            }}
            onDragStart={onPanelDrag}
          />
        </>
      ) : null}
    </div>
  );
}
