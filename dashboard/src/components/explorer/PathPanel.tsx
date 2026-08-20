import { Route } from "lucide-react";

import type { ExplorerPalette } from "./theme";
import { ACCENT } from "./theme";

interface PathPanelProps {
  sourceLabel: string | null;
  targetLabel: string | null;
  /** Hop count of the path found, or null when nothing has been run yet. */
  hops: number | null;
  error: string | null;
  pal: ExplorerPalette;
  isDark: boolean;
  onClear: () => void;
  onFindPath: () => void;
}

/**
 * Path traversal: pick two symbols on the canvas, get the shortest chain
 * between them highlighted.
 *
 * This is the question a maintainer actually asks of a dependency graph — "does
 * this reach that, and through what" — and it is the one thing a static picture
 * can never answer.
 */
export function PathPanel({
  sourceLabel,
  targetLabel,
  hops,
  error,
  pal,
  isDark,
  onClear,
  onFindPath,
}: PathPanelProps) {
  const slotStyle = (filled: boolean) => ({
    background: filled
      ? isDark
        ? "rgba(255,255,255,0.05)"
        : "rgba(0,0,0,0.04)"
      : "transparent",
    border: filled ? `1px solid ${pal.border}` : `1px dashed ${pal.dimText}`,
    color: filled ? pal.text : pal.dimText,
  });

  return (
    <div className="animate-rise-in space-y-4 p-3">
      <h3
        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: pal.dimText }}
      >
        <Route className="h-3 w-3" /> Path traversal
      </h3>
      <p className="text-xs leading-relaxed" style={{ color: pal.mutedText }}>
        Click two symbols on the canvas to find the shortest dependency chain
        between them. Direction is ignored — the question is whether they are
        connected at all.
      </p>

      <div className="space-y-3 pt-1">
        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: pal.dimText }}
          >
            From
          </label>
          <div
            className="truncate rounded-lg px-3 py-2 font-mono text-[12px]"
            style={slotStyle(sourceLabel !== null)}
          >
            {sourceLabel ?? "Click a symbol…"}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: pal.dimText }}
          >
            To
          </label>
          <div
            className="truncate rounded-lg px-3 py-2 font-mono text-[12px]"
            style={slotStyle(targetLabel !== null)}
          >
            {targetLabel ?? "Click a second symbol…"}
          </div>
        </div>
      </div>

      {error ? (
        <p
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            background: "rgba(239,83,80,0.14)",
            border: "1px solid rgba(239,83,80,0.28)",
            color: "#ef5350",
          }}
        >
          {error}
        </p>
      ) : null}

      {hops !== null && !error ? (
        <p
          className="rounded-lg px-3 py-2 text-xs font-bold"
          style={{
            background: "rgba(34,197,94,0.12)",
            border: "1px solid rgba(34,197,94,0.28)",
            color: "#22c55e",
          }}
        >
          {hops} {hops === 1 ? "hop" : "hops"} — the path is lit on the canvas.
        </p>
      ) : null}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClear}
          className="w-full rounded-lg py-2 text-[11px] font-bold uppercase tracking-widest transition-colors"
          style={{ border: `1px solid ${pal.border}`, color: pal.mutedText }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onFindPath}
          disabled={!sourceLabel || !targetLabel}
          className="w-full rounded-lg py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-opacity disabled:opacity-40"
          style={{ background: ACCENT }}
        >
          Find path
        </button>
      </div>
    </div>
  );
}
