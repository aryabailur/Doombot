import { ZoomIn, ZoomOut, Maximize, Route, Search, X } from "lucide-react";

export interface GraphControlsProps {
  search: string;
  onSearchChange: (value: string) => void;
  pathMode: boolean;
  onTogglePathMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  pathHint?: string | null;
}

export function GraphControls({
  search,
  onSearchChange,
  pathMode,
  onTogglePathMode,
  onZoomIn,
  onZoomOut,
  onFit,
  pathHint,
}: GraphControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-flat-sm">
      <div className="relative flex-1 min-w-[160px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" strokeWidth={2.5} />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search nodes…"
          aria-label="Search graph nodes"
          className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-xs font-medium text-ink outline-none focus-visible:border-info"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onTogglePathMode}
        aria-pressed={pathMode}
        title="Find path between two nodes"
        className={`flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-bold uppercase tracking-wide shadow-flat-sm transition-colors ${
          pathMode ? "bg-ink text-white" : "bg-card text-ink hover:bg-background"
        }`}
      >
        <Route className="h-3.5 w-3.5" strokeWidth={2.5} />
        Find Path
      </button>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Zoom out"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-ink shadow-flat-sm transition-colors hover:bg-background"
        >
          <ZoomOut className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Zoom in"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-ink shadow-flat-sm transition-colors hover:bg-background"
        >
          <ZoomIn className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onFit}
          aria-label="Fit graph to view"
          title="Fit to view"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-ink shadow-flat-sm transition-colors hover:bg-background"
        >
          <Maximize className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {pathMode && (
        <p className="w-full text-[11px] font-semibold text-muted">
          {pathHint ?? "Click a source node, then a target node."}
        </p>
      )}
    </div>
  );
}
