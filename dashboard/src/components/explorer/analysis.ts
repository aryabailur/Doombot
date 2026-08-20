/**
 * Structural analysis the explorer runs over a code graph, client-side.
 *
 * The reference viewer shows "Circular Dependencies" and "Unused Exports" as
 * permanently *pending* badges — placeholders its backend never fills in. Our
 * code graph already carries directed edges and degrees, so these can be real
 * numbers instead of a promise. Everything here is pure and O(V+E).
 */

export interface GraphEdge {
  source: string;
  target: string;
}

export interface DegreeCounts {
  in_degree: number;
  out_degree: number;
}

/** Directed adjacency, endpoints normalised (the simulation swaps in objects). */
export function endpointId(endpoint: unknown): string {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
    return String((endpoint as { id: unknown }).id);
  }
  return "";
}

export function linkKey(link: { source: unknown; target: unknown }): string {
  return `${endpointId(link.source)}->${endpointId(link.target)}`;
}

/**
 * Dependency cycles, as strongly connected components of size > 1.
 *
 * Iterative Tarjan rather than recursive: a thousand-symbol graph with a deep
 * call chain will blow the JS stack, and the browser tab dies with no error a
 * reader could act on.
 */
export function findCycles(nodeIds: string[], edges: GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    const from = endpointId(edge.source);
    const to = endpointId(edge.target);
    if (!adjacency.has(from) || !adjacency.has(to)) continue;
    adjacency.get(from)!.push(to);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of nodeIds) {
    if (index.has(root)) continue;

    // Each frame is a node plus how far through its neighbours we have walked.
    const work: { node: string; edge: number }[] = [{ node: root, edge: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbours = adjacency.get(frame.node) ?? [];

      if (frame.edge < neighbours.length) {
        const next = neighbours[frame.edge];
        frame.edge += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, edge: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }

      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        if (component.length > 1) components.push(component);
      }
    }
  }

  return components;
}

/** Self-referential edges: a symbol that calls itself is its own cycle. */
export function countSelfLoops(edges: GraphEdge[]): number {
  let total = 0;
  for (const edge of edges) {
    if (endpointId(edge.source) === endpointId(edge.target)) total += 1;
  }
  return total;
}

/**
 * Symbols nothing reaches and that reach nothing.
 *
 * Not automatically a defect — an entry point or a test helper is legitimately
 * unconnected — but a high count usually means the parser could not resolve
 * calls, which is worth knowing before trusting the layout.
 */
export function countOrphans(nodes: DegreeCounts[]): number {
  return nodes.filter((n) => n.in_degree + n.out_degree === 0).length;
}

/** Symbols with an unusually large fan-in: the things a change ripples from. */
export function countHubs(nodes: DegreeCounts[], threshold = 8): number {
  return nodes.filter((n) => n.in_degree >= threshold).length;
}

/**
 * Shortest path between two symbols, over undirected edges.
 *
 * Undirected on purpose: "how are these two related" is the question a reader
 * is asking, and a direction-respecting search answers a narrower one, usually
 * with "no path" when an obvious two-hop relationship exists.
 */
export function shortestPath(
  edges: { source: unknown; target: unknown }[],
  sourceId: string,
  targetId: string
): { nodes: Set<string>; links: Set<string> } | null {
  const adjacency = new Map<string, Set<string>>();
  const edgeAt = new Map<string, { source: unknown; target: unknown }>();

  for (const edge of edges) {
    const from = endpointId(edge.source);
    const to = endpointId(edge.target);
    if (!from || !to) continue;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
    edgeAt.set(`${from}->${to}`, edge);
    edgeAt.set(`${to}->${from}`, edge);
  }

  if (sourceId === targetId) return { nodes: new Set([sourceId]), links: new Set() };

  const queue: string[] = [sourceId];
  const parent = new Map<string, string>();
  const seen = new Set<string>([sourceId]);
  let found = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) {
      found = true;
      break;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, current);
      queue.push(next);
    }
  }

  if (!found) return null;

  const nodes = new Set<string>([targetId]);
  const links = new Set<string>();
  let cursor = targetId;
  while (cursor !== sourceId) {
    const previous = parent.get(cursor);
    if (previous === undefined) break;
    nodes.add(previous);
    const edge = edgeAt.get(`${previous}->${cursor}`);
    if (edge) links.add(linkKey(edge));
    cursor = previous;
  }

  return { nodes, links };
}

/** The node ids and edge keys within one hop of `rootId`. */
export function neighbourhoodOf(
  edges: { source: unknown; target: unknown }[],
  rootId: string
): { nodes: Set<string>; links: Set<string> } {
  const nodes = new Set<string>([rootId]);
  const links = new Set<string>();
  for (const edge of edges) {
    const from = endpointId(edge.source);
    const to = endpointId(edge.target);
    if (from !== rootId && to !== rootId) continue;
    nodes.add(from);
    nodes.add(to);
    links.add(linkKey(edge));
  }
  return { nodes, links };
}
