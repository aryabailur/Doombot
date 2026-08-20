import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Layers, Maximize, Moon, Sun, ZoomIn, ZoomOut } from "lucide-react";

import type { ExplorerPalette, VisualizationMode } from "./theme";
import { ACCENT, VISUALIZATION_MODES } from "./theme";

/** Live window size, so the canvas can be sized in pixels rather than CSS. */
export function useViewportSize() {
  const [size, setSize] = useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));

  useEffect(() => {
    function onResize() {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return size;
}

/**
 * Drag-to-resize for a side panel.
 *
 * `direction` is which way the pointer moves to make the panel wider: 1 for a
 * left-hand panel, -1 for a right-hand one.
 */
export function useDragResize(
  initial: number,
  min: number,
  max: number,
  direction: 1 | -1
): [number, (event: React.MouseEvent) => void, (width: number) => void] {
  const [width, setWidth] = useState(initial);
  const state = useRef({ startX: 0, startW: initial, active: false });

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      state.current = { startX: event.clientX, startW: width, active: true };

      function onMove(moveEvent: MouseEvent) {
        if (!state.current.active) return;
        const delta = (moveEvent.clientX - state.current.startX) * direction;
        setWidth(Math.min(max, Math.max(min, state.current.startW + delta)));
      }
      function onUp() {
        state.current.active = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, min, max, direction]
  );

  return [width, onMouseDown, setWidth];
}

/** Close a popover when the pointer goes down anywhere outside it. */
export function useDismissOnOutsideClick(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onDismiss]);
  return ref;
}

/** The rounded, blurred pill the explorer uses for every floating control. */
export function Pill({
  children,
  onClick,
  title,
  pal,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  pal: ExplorerPalette;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-bold uppercase tracking-widest shadow-2xl backdrop-blur-md transition-colors"
      style={{
        background: active ? "rgba(168,85,247,0.2)" : pal.overlayBg,
        borderColor: active ? "rgba(168,85,247,0.4)" : pal.border,
        color: pal.text,
      }}
    >
      {children}
    </button>
  );
}

export function ThemeToggle({
  isDark,
  pal,
  onToggle,
}: {
  isDark: boolean;
  pal: ExplorerPalette;
  onToggle: () => void;
}) {
  return (
    <Pill pal={pal} onClick={onToggle} title="Switch the explorer's theme">
      {isDark ? (
        <Sun className="h-3.5 w-3.5 text-amber-400" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-indigo-500" />
      )}
      {isDark ? "Light" : "Dark"}
    </Pill>
  );
}

/** Zoom in / fit / zoom out, stacked at the top-left of the viewport. */
export function ZoomControls({
  pal,
  isDark,
  disabled,
  onZoomIn,
  onFit,
  onZoomOut,
}: {
  pal: ExplorerPalette;
  isDark: boolean;
  disabled: boolean;
  onZoomIn: () => void;
  onFit: () => void;
  onZoomOut: () => void;
}) {
  const buttonStyle = {
    color: pal.textSecondary,
    borderBottom: `1px solid ${pal.border}`,
  };
  const hover = isDark ? "rgba(168,85,247,0.2)" : "rgba(0,0,0,0.05)";

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl"
      style={{
        background: pal.overlayBg,
        borderColor: pal.border,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {(
        [
          ["Zoom in", <ZoomIn key="i" className="h-5 w-5" />, onZoomIn],
          ["Fit to view", <Maximize key="f" className="h-5 w-5" />, onFit],
          ["Zoom out", <ZoomOut key="o" className="h-5 w-5" />, onZoomOut],
        ] as const
      ).map(([label, icon, handler], index) => (
        <button
          key={label}
          type="button"
          title={label}
          disabled={disabled}
          onClick={handler}
          className="p-3 transition-colors"
          style={index === 2 ? { color: pal.textSecondary } : buttonStyle}
          onMouseEnter={(event) => {
            if (!disabled) event.currentTarget.style.background = hover;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/** The visualization-mode dropdown, matching the reference viewer's menu. */
export function ModeMenu({
  mode,
  modes,
  pal,
  isDark,
  onMode,
}: {
  mode: VisualizationMode;
  /**
   * Which modes to offer. Defaults to all of them; the issue graph passes a
   * subset because a repository's issues have no source files, so the City and
   * Flowchart modes would render an empty diagram rather than a useful one.
   */
  modes?: VisualizationMode[];
  pal: ExplorerPalette;
  isDark: boolean;
  onMode: (mode: VisualizationMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissOnOutsideClick(useCallback(() => setOpen(false), []));
  const available = modes
    ? VISUALIZATION_MODES.filter((entry) => modes.includes(entry.id))
    : VISUALIZATION_MODES;
  const current = available.find((entry) => entry.id === mode);

  return (
    <div ref={ref} className="relative">
      <Pill pal={pal} onClick={() => setOpen((value) => !value)} active={open}>
        <Layers className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        {current?.name ?? mode}
        <ChevronDown
          className="h-3 w-3 transition-transform"
          style={{
            color: pal.dimText,
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </Pill>

      {open ? (
        <div
          className="animate-rise-in absolute right-0 top-full z-[100] mt-2 min-w-[290px] overflow-hidden rounded-2xl border py-1.5 shadow-2xl backdrop-blur-xl"
          style={{
            background: isDark ? "rgba(0,0,0,0.92)" : "rgba(255,255,255,0.96)",
            borderColor: pal.border,
          }}
        >
          {available.map((entry) => {
            const selected = entry.id === mode;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  onMode(entry.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                style={{
                  background: selected
                    ? isDark
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(0,0,0,0.06)"
                    : "transparent",
                  color: selected ? pal.text : pal.mutedText,
                }}
              >
                <span
                  aria-hidden
                  className="h-3 w-3 flex-none rounded-full"
                  style={{
                    backgroundColor: entry.previewColor,
                    boxShadow: `0 0 8px ${entry.previewColor}`,
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold tracking-wide">
                    {entry.name}
                  </span>
                  <span className="block text-[10px]" style={{ color: pal.dimText }}>
                    {entry.description}
                  </span>
                </span>
                {selected ? (
                  <Check className="h-3.5 w-3.5 flex-none" style={{ color: ACCENT }} />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The keyboard/mouse cheatsheet shown in the 3D modes. */
export function NavigationHints({
  pal,
  isDark,
  hints,
}: {
  pal: ExplorerPalette;
  isDark: boolean;
  hints: [string, string][];
}) {
  return (
    <div
      className="pointer-events-none select-none rounded-xl px-5 py-4 font-mono text-[11px] backdrop-blur-md"
      style={{
        background: isDark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)",
        border: `1px solid ${pal.border}`,
      }}
    >
      <div
        className="mb-3 text-[10px] font-black uppercase tracking-[0.15em]"
        style={{ color: pal.mutedText }}
      >
        Navigation
      </div>
      {hints.map(([label, key]) => (
        <div key={label} className="flex items-center justify-between gap-6 py-[3px]">
          <span style={{ color: pal.dimText }}>{label}</span>
          <span
            className="rounded px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
              color: pal.text,
            }}
          >
            {key}
          </span>
        </div>
      ))}
    </div>
  );
}
