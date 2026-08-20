/**
 * File-tree construction for the explorer sidebar.
 *
 * Pure and dependency-free so it can be reasoned about (and tested) without a
 * DOM. Ported from CodeGraphContext's `buildTree`.
 */

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/**
 * Nest a flat list of repository-relative paths into a folder tree.
 *
 * Leaf nodes keep the *original* full path rather than a reconstructed join:
 * the graph's `file_path` values are matched against it, and a path rebuilt
 * from split parts can differ (a leading `./`, a doubled separator) in ways
 * that silently break every file-to-node lookup.
 */
export function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const filePath of files) {
    const parts = filePath.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const nodePath = isLast ? filePath : parts.slice(0, i + 1).join("/");

      let node = current.find((n) => n.name === part && n.isDir === !isLast);
      if (!node) {
        node = { name: part, path: nodePath, isDir: !isLast, children: [] };
        current.push(node);
      }
      current = node.children;
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));

  return sortNodes(root);
}

/**
 * Collapse folders that contain exactly one folder and nothing else.
 *
 * `dashboard/src/components/explorer` is four clicks deep for one meaningful
 * choice. Rendered as a single `dashboard/src/components/explorer` row it costs
 * one line instead of four and reads the way a developer says the path out
 * loud.
 */
export function collapseSingleChildDirs(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (!node.isDir) return node;

    let current = node;
    const names = [node.name];
    while (current.children.length === 1 && current.children[0].isDir) {
      current = current.children[0];
      names.push(current.name);
    }

    return {
      name: names.join("/"),
      path: current.path,
      isDir: true,
      children: collapseSingleChildDirs(current.children),
    };
  });
}

/** Dot colour per file extension, so the tree reads by language at a glance. */
export const EXT_COLORS: Record<string, string> = {
  py: "#ffca28",
  ts: "#42a5f5",
  tsx: "#42a5f5",
  js: "#f59e0b",
  jsx: "#f59e0b",
  mjs: "#f59e0b",
  rs: "#ef5350",
  go: "#26a69a",
  java: "#ef9a9a",
  c: "#90caf9",
  h: "#90caf9",
  cpp: "#7986cb",
  cs: "#b39ddb",
  rb: "#ef5350",
  php: "#9fa8da",
  swift: "#ffa726",
  kt: "#ab47bc",
  scala: "#e91e63",
  md: "#80cbc4",
  json: "#a5d6a7",
  yml: "#80deea",
  yaml: "#80deea",
  toml: "#ffcc02",
  sh: "#a5d6a7",
  css: "#ce93d8",
  html: "#ffab91",
};

export function extColor(fileName: string): string {
  const ext = fileName.split(".").pop() ?? "";
  return EXT_COLORS[ext] ?? "#78909c";
}

/** Does this subtree contain anything matching the filter? */
export function matchesQuery(node: TreeNode, query: string): boolean {
  const needle = query.toLowerCase();
  if (node.name.toLowerCase().includes(needle)) return true;
  return node.children.some((child) => matchesQuery(child, needle));
}
