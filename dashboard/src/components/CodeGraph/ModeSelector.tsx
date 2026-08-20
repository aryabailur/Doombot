import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type GraphVisualizationMode =
  | "classic"
  | "galaxy"
  | "mermaid"
  | "graph3d";

export interface ModeSelectorProps {
  mode: GraphVisualizationMode;
  onChange: (mode: GraphVisualizationMode) => void;
}

interface ModeOption {
  value: GraphVisualizationMode;
  label: string;
  swatch: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: "classic", label: "Classic", swatch: "var(--info)" },
  { value: "galaxy", label: "Galaxy", swatch: "var(--lilac)" },
  { value: "mermaid", label: "Flowchart", swatch: "var(--success)" },
  { value: "graph3d", label: "Graph 3D", swatch: "var(--ink)" },
];

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = MODE_OPTIONS.find((option) => option.value === mode) ?? MODE_OPTIONS[0];

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold uppercase tracking-wide text-ink shadow-flat-sm transition-colors hover:bg-background"
      >
        <span className="h-2.5 w-2.5 rounded-full border border-border" style={{ backgroundColor: active.swatch }} />
        {active.label}
        <ChevronDown className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.5} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-lg border border-border bg-card shadow-flat-sm"
        >
          {MODE_OPTIONS.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === mode}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold transition-colors ${
                  option.value === mode ? "bg-accent-soft text-ink" : "text-ink hover:bg-background"
                }`}
              >
                <span className="h-2.5 w-2.5 flex-none rounded-full border border-border" style={{ backgroundColor: option.swatch }} />
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
