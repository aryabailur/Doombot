import type { ReactNode } from "react";
import {
  AlertTriangle,
  Boxes,
  FileCode2,
  Link2,
  Loader2,
  Puzzle,
  Repeat,
} from "lucide-react";

import type { ExplorerPalette } from "./theme";

export interface StatBarWarning {
  title: string;
  value: number;
  /** Non-zero is a finding worth an amber badge; zero is a clean green one. */
  isWarning: boolean;
  hint: string;
}

interface StatBarProps {
  loading: boolean;
  loadingLabel: string;
  stats: { icon: ReactNode; label: string; value: number }[];
  warnings: StatBarWarning[];
  pal: ExplorerPalette;
  isDark: boolean;
}

/**
 * The floating stat strip across the top of the viewport.
 *
 * Mirrors CodeGraphContext's `RepositorySummary`, with one difference: its
 * warning badges render "Pending" forever because nothing computes them. Ours
 * are real — see `analysis.ts` — so a zero means checked and clean rather than
 * not implemented.
 */
export function StatBar({
  loading,
  loadingLabel,
  stats,
  warnings,
  pal,
  isDark,
}: StatBarProps) {
  if (loading) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full border px-4 py-2 shadow-2xl backdrop-blur-xl"
        style={{ background: pal.overlayBg, borderColor: pal.border }}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: pal.mutedText }}
        >
          {loadingLabel}
        </span>
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex w-full max-w-4xl flex-col items-center gap-2">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto pb-1">
        <div
          className="flex items-center rounded-2xl border p-1 shadow-2xl backdrop-blur-3xl"
          style={{ background: pal.overlayBg, borderColor: pal.border }}
        >
          {stats.map((stat, index) => (
            <div key={stat.label} className="flex items-center">
              {index > 0 ? (
                <div
                  aria-hidden
                  className="mx-1 h-6 w-px"
                  style={{ background: pal.border }}
                />
              ) : null}
              <div className="flex items-center gap-3 rounded-xl px-4 py-2">
                <div
                  className="[&>svg]:h-4 [&>svg]:w-4"
                  style={{ color: pal.dimText }}
                >
                  {stat.icon}
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[14px] font-black leading-tight"
                    style={{ color: pal.text }}
                  >
                    {stat.value.toLocaleString()}
                  </span>
                  <span
                    className="text-[9px] font-bold uppercase leading-tight tracking-widest"
                    style={{ color: pal.dimText }}
                  >
                    {stat.label}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
          {warnings.map((warning) => (
            <div
              key={warning.title}
              title={warning.hint}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 shadow-lg backdrop-blur-xl"
              style={{
                background: warning.isWarning
                  ? "rgba(245,158,11,0.12)"
                  : isDark
                    ? "rgba(34,197,94,0.1)"
                    : "rgba(34,197,94,0.14)",
                borderColor: warning.isWarning
                  ? "rgba(245,158,11,0.3)"
                  : "rgba(34,197,94,0.28)",
                color: warning.isWarning ? "#f59e0b" : "#22c55e",
              }}
            >
              {warning.isWarning ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
              <span className="text-[9px] font-bold uppercase tracking-widest">
                {warning.value} {warning.title}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The icon set the code-graph stat strip uses, kept beside the component. */
export const STAT_ICONS = {
  files: <FileCode2 />,
  subsystems: <Boxes />,
  symbols: <Puzzle />,
  dependencies: <Link2 />,
  cycles: <Repeat />,
};
