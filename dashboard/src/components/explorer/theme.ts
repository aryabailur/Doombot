/**
 * The explorer's own palette, deliberately separate from index.css.
 *
 * Every other screen in RepoGuardian is the light "Calm Control Room" system
 * and reads its colours from CSS custom properties. The explorer is a dark,
 * full-bleed canvas surface with its own light/dark toggle, so it cannot share
 * those tokens: the canvas renderer needs literal colour strings at paint time,
 * and the two themes here have to be switchable without touching the document
 * root and re-skinning the eleven pages behind it.
 *
 * Modelled on CodeGraphContext's viewer (website/src/components/
 * CodeGraphViewer.tsx), which is the reference this explorer follows.
 */

export interface ExplorerPalette {
  bg: string;
  panelBg: string;
  text: string;
  textSecondary: string;
  mutedText: string;
  dimText: string;
  border: string;
  nodeLabel: string;
  nodeLabelDim: string;
  labelPlate: string;
  canvasBg: string;
  viewportGradient: string;
  overlayBg: string;
  overlayHover: string;
}

export const PALETTE: { dark: ExplorerPalette; light: ExplorerPalette } = {
  dark: {
    bg: "#020202",
    panelBg: "#0d0d0d",
    text: "#ffffff",
    textSecondary: "#d4d4d8",
    mutedText: "#9ca3af",
    dimText: "#6b7280",
    border: "rgba(255,255,255,0.07)",
    nodeLabel: "rgba(255,255,255,0.9)",
    nodeLabelDim: "rgba(255,255,255,0.1)",
    labelPlate: "rgba(2,2,2,0.78)",
    canvasBg: "#020202",
    viewportGradient:
      "radial-gradient(circle at center, #0a0a0a 0%, #000000 100%)",
    overlayBg: "rgba(0,0,0,0.55)",
    overlayHover: "rgba(168,85,247,0.14)",
  },
  light: {
    bg: "#f5f5f7",
    panelBg: "#ffffff",
    text: "#1a1a1a",
    textSecondary: "#374151",
    mutedText: "#6b7280",
    dimText: "#9ca3af",
    border: "rgba(0,0,0,0.1)",
    nodeLabel: "rgba(0,0,0,0.85)",
    nodeLabelDim: "rgba(0,0,0,0.08)",
    labelPlate: "rgba(255,255,255,0.82)",
    canvasBg: "#f5f5f7",
    viewportGradient:
      "radial-gradient(circle at center, #f0f0f2 0%, #e8e8ec 100%)",
    overlayBg: "rgba(255,255,255,0.82)",
    overlayHover: "rgba(168,85,247,0.08)",
  },
};

/** The accent the explorer chrome uses, matching the reference viewer. */
export const ACCENT = "#a855f7";

/**
 * Colour per symbol kind.
 *
 * These are the kinds `rag/graph.py` actually emits (`_python_kind` and
 * `_typescript_kind`), not a generic node-type list — a legend entry for a
 * kind this project never produces is noise.
 */
export const NODE_COLORS: Record<string, string> = {
  class: "#66bb6a",
  component: "#42a5f5",
  function: "#ffca28",
  method: "#9575cd",
  api_handler: "#ef5350",
  hook: "#26c6da",
  graph_node: "#ec407a",
  other: "#78909c",
};

export const KIND_LABELS: Record<string, string> = {
  class: "Class",
  component: "Component",
  function: "Function",
  method: "Method",
  api_handler: "API handler",
  hook: "Hook",
  graph_node: "Graph node",
  other: "Other",
};

/** Emoji per kind, for the Icon visualization mode. */
export const EMOJI_MAP: Record<string, string> = {
  class: "🏛️",
  component: "🧩",
  function: "⚙️",
  method: "🔧",
  api_handler: "🛰️",
  hook: "🪝",
  graph_node: "🔗",
  other: "❓",
};

/** Colour per dependency kind. The three edge types `CodeGraphLink` can carry. */
export const EDGE_COLORS: Record<string, string> = {
  calls: "#ab47bc",
  renders: "#42a5f5",
  http_calls: "#26a69a",
};

export const EDGE_LABELS: Record<string, string> = {
  calls: "Calls",
  renders: "Renders",
  http_calls: "HTTP call",
};

/** Relative building height per kind, for the City 3D mode. */
export const CITY_HEIGHTS: Record<string, number> = {
  class: 8,
  component: 7,
  api_handler: 9,
  graph_node: 6,
  hook: 4,
  method: 3,
  function: 4,
  other: 2,
};

export type VisualizationMode =
  | "classic"
  | "curvy"
  | "flowchart"
  | "icon"
  | "city3d"
  | "graph3d"
  | "neon"
  | "galaxy";

export const VISUALIZATION_MODES: {
  id: VisualizationMode;
  name: string;
  description: string;
  previewColor: string;
}[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Standard coloured circles",
    previewColor: "#42a5f5",
  },
  {
    id: "curvy",
    name: "Curvy 2D",
    description: "Smooth bezier curved edges",
    previewColor: "#ec407a",
  },
  {
    id: "flowchart",
    name: "Flowchart",
    description: "Layered SVG diagram, no simulation",
    previewColor: "#26c6da",
  },
  {
    id: "icon",
    name: "Icon",
    description: "Emoji glyph per symbol kind",
    previewColor: "#ffca28",
  },
  {
    id: "city3d",
    name: "City 3D",
    description: "Subsystems as islands, symbols as towers",
    previewColor: "#ff9800",
  },
  {
    id: "graph3d",
    name: "3D Graph",
    description: "Server-computed 3D layout, spheres",
    previewColor: "#42a5f5",
  },
  {
    id: "neon",
    name: "Neon Glow",
    description: "Bloom on every node and edge",
    previewColor: "#00ff88",
  },
  {
    id: "galaxy",
    name: "Galaxy",
    description: "Orbital rings scaled by connections",
    previewColor: "#7e57c2",
  },
];

/** True for the two modes that need WebGL and the lazily-loaded 3D bundle. */
export function is3D(mode: VisualizationMode): boolean {
  return mode === "city3d" || mode === "graph3d";
}

/** Issue-graph categories, for the explorer's issue source. */
export const ISSUE_CATEGORY_COLORS: Record<string, string> = {
  security: "#ef5350",
  duplicate: "#42a5f5",
  stale: "#ffca28",
  resolved: "#66bb6a",
  open: "#78909c",
};

export const ISSUE_CATEGORY_LABELS: Record<string, string> = {
  security: "Security",
  duplicate: "Duplicate",
  stale: "Stale",
  resolved: "Resolved",
  open: "Open",
};

export const ISSUE_LINK_COLORS: Record<string, string> = {
  duplicate: "#ef5350",
  similar: "#42a5f5",
  reference: "#ffca28",
  metadata: "#78909c",
};

export const ISSUE_LINK_LABELS: Record<string, string> = {
  duplicate: "Likely duplicate",
  similar: "Related",
  reference: "Explicit reference",
  metadata: "Shared label",
};

/** `#rrggbb` plus an alpha, for canvas fills. */
export function getRGBA(hex: string, alpha: number): string {
  if (!hex.startsWith("#") || hex.length < 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Shrink nodes as the graph grows.
 *
 * A radius that reads well at 60 symbols turns 1,000 into one solid disc. This
 * is the reference viewer's curve: roughly 2.5x at a handful of nodes, down to
 * about 0.45x past a few thousand.
 */
export function graphAwareNodeScale(totalNodes: number): number {
  const safe = Math.max(totalNodes, 1);
  return clamp(2.5 / (1 + Math.log10(safe) * 0.95), 0.45, 2.5);
}
