/**
 * Deterministic architecture summaries for a selected symbol.
 *
 * No model is involved, exactly as in the reference viewer's `summary-engine`:
 * every sentence below is derived from fields the code graph already carries.
 * That matters here more than it does there — RepoGuardian's whole claim is that
 * it shows its work, so a panel that quietly asked an LLM to describe a symbol
 * would be the one unsourced assertion in the product.
 */

import type { CodeGraphLink, CodeGraphNode } from "@/lib/types";
import { endpointId } from "./analysis";
import { EDGE_LABELS, KIND_LABELS } from "./theme";

export interface SymbolRelation {
  id: string;
  label: string;
  filePath: string;
  edgeType: string;
  why: string;
}

export interface SymbolSummary {
  role: string;
  position: string;
  impact: string;
  callers: SymbolRelation[];
  callees: SymbolRelation[];
}

const KIND_ROLES: Record<string, string> = {
  api_handler:
    "An HTTP entry point. Requests arrive here from outside the process, so its contract is public and a change to it is a change to the API surface.",
  graph_node:
    "A LangGraph step. It runs inside the agent's investigation chain and returns a state patch plus evidence, so its output is what the dashboard streams.",
  component:
    "A React component. It renders part of the interface and is reached from a route or another component rather than called directly.",
  hook: "A React hook. It packages state or an effect for reuse, so its callers all inherit whatever it does on every render.",
  class:
    "A class. It groups state with the methods that operate on it, so its methods share whatever invariants the constructor establishes.",
  method:
    "A method on a class. Its behaviour depends on the instance it is called on, which is why its callers are usually within the same file.",
  function:
    "A plain function. Its inputs and outputs are the whole of its contract, which makes it the cheapest kind of symbol to change safely.",
};

function pluralise(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Build the three prose blocks and the two relation lists for one symbol.
 *
 * `links` is the *unfiltered* link list on purpose: the panel should report
 * what depends on this symbol in the repository, not what happens to survive
 * the reader's current minimum-connections setting.
 */
export function summariseSymbol(
  node: CodeGraphNode,
  nodes: CodeGraphNode[],
  links: CodeGraphLink[]
): SymbolSummary {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const callers: SymbolRelation[] = [];
  const callees: SymbolRelation[] = [];

  for (const link of links) {
    const from = endpointId(link.source);
    const to = endpointId(link.target);

    if (to === node.id) {
      const other = byId.get(from);
      callers.push({
        id: from,
        label: other?.qualname ?? from,
        filePath: other?.file_path ?? "",
        edgeType: link.edge_type,
        why: link.why,
      });
    } else if (from === node.id) {
      const other = byId.get(to);
      callees.push({
        id: to,
        label: other?.qualname ?? to,
        filePath: other?.file_path ?? "",
        edgeType: link.edge_type,
        why: link.why,
      });
    }
  }

  const kindLabel = (KIND_LABELS[node.kind] ?? node.kind).toLowerCase();
  const role =
    KIND_ROLES[node.kind] ??
    `A ${kindLabel} in ${node.language}. The graph resolved its dependencies from source, without a model.`;

  const spanLines = Math.max(1, node.end_line - node.start_line + 1);
  const position = [
    `Lives in the ${node.cluster_label} subsystem, running ${node.runtime}-side,`,
    `at ${node.file_path}:${node.start_line}–${node.end_line}`,
    `(${pluralise(spanLines, "line")}).`,
  ].join(" ");

  let impact: string;
  if (callers.length === 0 && callees.length === 0) {
    impact =
      "Nothing in the indexed source calls this, and it calls nothing. Either it is an entry point, or the parser could not resolve its callers — treat a zero here as unproven, not as dead code.";
  } else if (callers.length === 0) {
    impact = `Nothing calls this, but it reaches ${pluralise(
      callees.length,
      "symbol"
    )}. That shape is typical of an entry point: a route handler, a CLI command, or a test.`;
  } else if (callers.length >= 8) {
    impact = `${pluralise(
      callers.length,
      "symbol"
    )} depend on this one, which makes it a hub — a change here ripples further than anywhere else in ${
      node.cluster_label
    }. It reaches ${pluralise(callees.length, "symbol")} of its own.`;
  } else {
    impact = `${pluralise(callers.length, "caller")} and ${pluralise(
      callees.length,
      "callee"
    )}. Hub score ${node.hub_score.toFixed(3)}, meaning it sits on ${(
      node.hub_score * 100
    ).toFixed(1)}% of the connections a fully-linked symbol would have.`;
  }

  const sortRelations = (relations: SymbolRelation[]) =>
    relations.sort((a, b) => a.label.localeCompare(b.label));

  return {
    role,
    position,
    impact,
    callers: sortRelations(callers),
    callees: sortRelations(callees),
  };
}

/** A short human label for one edge, used in the relation lists. */
export function edgeLabel(edgeType: string): string {
  return EDGE_LABELS[edgeType] ?? edgeType;
}
