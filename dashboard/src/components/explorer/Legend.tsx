import { ChevronUp } from "lucide-react";

import type { ExplorerPalette, VisualizationMode } from "./theme";
import { ACCENT, EMOJI_MAP } from "./theme";

export interface LegendEntry {
  id: string;
  label: string;
  color: string;
  count: number;
  visible: boolean;
}

interface LegendProps {
  title: string;
  entries: LegendEntry[];
  collapsed: boolean;
  mode?: VisualizationMode;
  pal: ExplorerPalette;
  isDark: boolean;
  onToggleCollapsed: () => void;
  onOpenFilters: () => void;
  onToggleEntry?: (id: string) => void;
}

/**
 * The bottom-right legend overlay.
 *
 * Clickable, unlike the reference's read-only version: a legend that shows a
 * colour you cannot switch off sends you hunting for the settings panel for the
 * single most common thing anyone wants to do with it. The "Filters" link is
 * still there for everything else.
 */
export function Legend({
  title,
  entries,
  collapsed,
  mode,
  pal,
  isDark,
  onToggleCollapsed,
  onOpenFilters,
  onToggleEntry,
}: LegendProps) {
  return (
    <div
      className="pointer-events-auto rounded-2xl border shadow-2xl backdrop-blur-3xl"
      style={{ background: pal.overlayBg, borderColor: pal.border }}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className={`flex w-full items-center justify-between gap-6 rounded-t-2xl px-5 pt-4 transition-colors ${
          collapsed ? "pb-4" : "pb-2"
        }`}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: pal.dimText }}
        >
          {title}
        </span>
        <span className="flex items-center gap-2">
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFilters();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
                onOpenFilters();
              }
            }}
            className="text-[10px] font-bold uppercase tracking-widest transition-opacity hover:opacity-100"
            style={{ color: ACCENT, opacity: 0.7 }}
          >
            Filters
          </span>
          <ChevronUp
            className="h-3 w-3 transition-transform"
            style={{
              color: pal.dimText,
              transform: collapsed ? "rotate(180deg)" : "none",
            }}
          />
        </span>
      </button>

      {!collapsed ? (
        <div className="flex max-w-md flex-wrap justify-end gap-x-5 gap-y-3 px-5 pb-4">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={!onToggleEntry}
              onClick={() => onToggleEntry?.(entry.id)}
              className="flex items-center gap-2 transition-opacity disabled:cursor-default"
              style={{ opacity: entry.visible ? 1 : 0.45 }}
            >
              {mode === "icon" ? (
                <span className="text-[12px]">{EMOJI_MAP[entry.id] ?? "❓"}</span>
              ) : (
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: entry.color,
                    boxShadow: entry.visible ? `0 0 8px ${entry.color}` : "none",
                  }}
                />
              )}
              <span
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{
                  color: entry.visible
                    ? isDark
                      ? "#d1d5db"
                      : "#374151"
                    : pal.dimText,
                  textDecoration: entry.visible ? "none" : "line-through",
                }}
              >
                {entry.label}
                {entry.count > 0 ? ` ${entry.count}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
