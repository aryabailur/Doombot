import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { GraphNodeType } from "./CodeGraphViewer";

export interface LegendEntry {
  type: GraphNodeType;
  color: string;
  icon: string;
  count: number;
}

export interface GraphLegendProps {
  entries: LegendEntry[];
  visibleTypes: Set<GraphNodeType>;
  onToggleType: (type: GraphNodeType) => void;
}

export function GraphLegend({ entries, visibleTypes, onToggleType }: GraphLegendProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="w-52 overflow-hidden rounded-2xl border border-border bg-card shadow-flat-sm">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5"
        aria-expanded={!collapsed}
      >
        <span className="text-xs font-bold uppercase tracking-wide text-ink">Legend</span>
        {collapsed ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted" strokeWidth={2.5} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted" strokeWidth={2.5} />
        )}
      </button>

      {!collapsed && (
        <ul className="flex flex-col gap-0.5 border-t border-border px-2 py-2">
          {entries.map((entry) => {
            const visible = visibleTypes.has(entry.type);
            return (
              <li key={entry.type}>
                <button
                  type="button"
                  onClick={() => onToggleType(entry.type)}
                  aria-pressed={visible}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition-colors ${
                    visible ? "text-ink hover:bg-background" : "text-muted line-through opacity-50 hover:bg-background"
                  }`}
                >
                  <span
                    className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-border text-[10px]"
                    style={{ backgroundColor: visible ? entry.color : "transparent" }}
                  >
                    {entry.icon}
                  </span>
                  <span className="flex-1 truncate">{entry.type}</span>
                  <span className="font-mono text-[10px] text-muted">{entry.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
