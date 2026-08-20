import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";

import type { ExplorerPalette } from "./theme";
import { ACCENT } from "./theme";
import { extColor, matchesQuery, type TreeNode } from "./tree";

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  symbolCounts: Map<string, number>;
  searchQuery: string;
  pal: ExplorerPalette;
  isDark: boolean;
  onFileClick: (path: string) => void;
}

/**
 * One row of the project tree: a folder that opens, or a file that focuses the
 * graph on itself.
 *
 * Ported from CodeGraphContext's `TreeItem`, with a symbol count added — a file
 * the graph has no symbols for looks identical to a busy one otherwise, and
 * clicking it appears to do nothing.
 */
export function TreeItem({
  node,
  depth,
  selectedFile,
  symbolCounts,
  searchQuery,
  pal,
  isDark,
  onFileClick,
}: TreeItemProps) {
  // Two levels open by default: enough to show the shape of a repository
  // without unrolling every test fixture.
  const [open, setOpen] = useState(depth < 2);

  useEffect(() => {
    if (searchQuery) setOpen(true);
  }, [searchQuery]);

  if (searchQuery && !matchesQuery(node, searchQuery)) return null;

  const indent = depth * 12;
  const hoverBg = isDark ? "rgba(168,85,247,0.12)" : "rgba(168,85,247,0.08)";

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full items-center gap-1 rounded-lg py-[3px] pr-2 transition-colors"
          style={{ paddingLeft: `${indent + 8}px` }}
          onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 flex-none" style={{ color: pal.dimText }} />
          ) : (
            <ChevronRight className="h-3 w-3 flex-none" style={{ color: pal.dimText }} />
          )}
          {open ? (
            <FolderOpen className="ml-0.5 h-3.5 w-3.5 flex-none text-amber-400" />
          ) : (
            <Folder className="ml-0.5 h-3.5 w-3.5 flex-none text-amber-400" />
          )}
          <span
            className="ml-1 truncate text-[13px] font-medium"
            style={{ color: pal.textSecondary }}
          >
            {node.name}
          </span>
        </button>
        {open ? (
          <div>
            {node.children.map((child) => (
              <TreeItem
                key={`${child.path}:${child.isDir}`}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                symbolCounts={symbolCounts}
                searchQuery={searchQuery}
                pal={pal}
                isDark={isDark}
                onFileClick={onFileClick}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const isSelected = selectedFile === node.path;
  const dotColor = extColor(node.name);
  const count = symbolCounts.get(node.path) ?? 0;

  return (
    <button
      type="button"
      onClick={() => onFileClick(node.path)}
      title={node.path}
      className="group flex w-full items-center gap-2 rounded-lg py-[3px] pr-2 text-[13px] transition-colors"
      style={{
        paddingLeft: `${indent + 20}px`,
        background: isSelected ? "rgba(168,85,247,0.2)" : "transparent",
        border: `1px solid ${isSelected ? "rgba(168,85,247,0.35)" : "transparent"}`,
        color: isSelected ? (isDark ? "#e9d5ff" : "#6b21a8") : pal.mutedText,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 flex-none rounded-full"
        style={{
          backgroundColor: dotColor,
          boxShadow: isSelected ? `0 0 6px ${dotColor}` : "none",
        }}
      />
      <span className="truncate font-medium">{node.name}</span>
      {/* A file the parser found nothing in is worth marking: clicking it
          otherwise looks broken rather than empty. */}
      <span
        className="ml-auto flex-none font-mono text-[9px]"
        style={{ color: count === 0 ? pal.dimText : ACCENT }}
      >
        {count === 0 ? "—" : count}
      </span>
    </button>
  );
}
