import type {
  RepoSummary,
  HealthResponse,
  InvestigationSummary,
  InvestigationDetail,
  Escalation,
  BriefResponse,
  CodeGraphNode,
  CodeGraphResponse,
  IssueGraphResponse,
  SearchResponse,
  SourceFile,
} from "./types";

export const mockRepos: RepoSummary[] = [
  {
    repo_name: "octocat/Hello-World",
    health_score: 82.4,
    open_investigations: 3,
    last_scan: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    repo_name: "doombot-labs/agent-runtime",
    health_score: 67.1,
    open_investigations: 7,
    last_scan: new Date(Date.now() - 21600_000).toISOString(),
  },
  {
    repo_name: "doombot-labs/rag-indexer",
    health_score: 91.0,
    open_investigations: 1,
    last_scan: new Date(Date.now() - 900_000).toISOString(),
  },
];

export const mockHealth: HealthResponse = {
  score: 82.4,
  breakdown: { security: 88, staleness: 71.5, duplication: 90, responsiveness: 78.3 },
  history: Array.from({ length: 7 }).map((_, i) => ({
    ts: new Date(Date.now() - (6 - i) * 86400_000).toISOString(),
    score: 74 + i * 1.3,
  })),
  measured: true,
  issue_count: 24,
  unreadable: false,
};

export const mockInvestigations: InvestigationSummary[] = [
  {
    investigation_id: "inv-fixture-003",
    repo_name: "octocat/Hello-World",
    kind: "issue",
    number: 42,
    title: "Memory leak when parsing large payloads",
    status: "running",
    decision: null,
    created_at: new Date(Date.now() - 120_000).toISOString(),
    completed_at: null,
  },
  {
    investigation_id: "inv-fixture-002",
    repo_name: "octocat/Hello-World",
    kind: "pr",
    number: 17,
    title: "Add retry/backoff to webhook dispatcher",
    status: "done",
    decision: "approve",
    created_at: new Date(Date.now() - 10800_000).toISOString(),
    completed_at: new Date(Date.now() - 10200_000).toISOString(),
  },
  {
    investigation_id: "inv-fixture-001",
    repo_name: "octocat/Spoon-Knife",
    kind: "issue",
    number: 9,
    title: "Duplicate of #3: crash on empty input",
    status: "done",
    decision: "close_as_duplicate",
    created_at: new Date(Date.now() - 86400_000).toISOString(),
    completed_at: new Date(Date.now() - 86000_000).toISOString(),
  },
];

export function mockInvestigationDetail(id: string): InvestigationDetail {
  const base = mockInvestigations.find((i) => i.investigation_id === id) ?? mockInvestigations[0];
  return {
    ...base,
    investigation_id: id,
    steps: [
      {
        step_id: "step-1",
        investigation_id: id,
        seq: 1,
        name: "fetch_context",
        title: "Fetch issue context",
        status: "done",
        input_summary: `issue #${base.number} in ${base.repo_name}`,
        output_summary: "Loaded issue body, 6 comments, 2 linked PRs",
        evidence: [
          {
            type: "file",
            ref: "src/parser/stream.py",
            score: 0.82,
            snippet: "def parse_chunk(buf): ...  # unbounded buffer growth",
          },
        ],
        duration_ms: 4000,
        started_at: new Date(Date.now() - 60_000).toISOString(),
        ended_at: new Date(Date.now() - 56_000).toISOString(),
      },
      {
        step_id: "step-2",
        investigation_id: id,
        seq: 2,
        name: "search_duplicates",
        title: "Search for duplicate issues",
        status: "done",
        input_summary: "embedding query over open issues",
        output_summary: "Found 1 related issue with 0.74 similarity, not a strict duplicate",
        evidence: [
          {
            type: "issue",
            ref: "31",
            score: 0.74,
            snippet: "Issue #31: 'High memory usage during import' — related but distinct root cause",
          },
          {
            type: "rule",
            ref: "CVE-2023-xxxxx",
            score: 0.41,
            snippet: "Low-confidence match against known unbounded-buffer advisory",
          },
        ],
        duration_ms: 9000,
        started_at: new Date(Date.now() - 56_000).toISOString(),
        ended_at: new Date(Date.now() - 47_000).toISOString(),
      },
      {
        step_id: "step-3",
        investigation_id: id,
        seq: 3,
        name: "decide",
        title: "Synthesize decision",
        status: base.status === "running" ? "running" : "done",
        input_summary: "context + duplicate search results",
        output_summary: base.status === "running" ? "" : "Escalated: high impact, needs human review",
        evidence: [],
        duration_ms: 3000,
        started_at: new Date(Date.now() - 47_000).toISOString(),
        ended_at: base.status === "running" ? null : new Date(Date.now() - 44_000).toISOString(),
      },
    ],
    decision_reason:
      "Buffer in parse_chunk grows unbounded on large payloads; related to #31 but distinct enough to track separately. Recommend triage as bug, high priority.",
    confidence: 0.78,
    impact_score: 0.63,
  };
}

export const mockEscalations: Escalation[] = [
  {
    investigation_id: "inv-fixture-003",
    reason: "Potential memory-safety issue with no assigned owner for 48h",
    severity: "high",
    number: 42,
    title: "Memory leak when parsing large payloads",
    created_at: new Date(Date.now() - 3000_000).toISOString(),
  },
  {
    investigation_id: "inv-fixture-002",
    reason: "PR touches auth middleware; flagged for manual security review",
    severity: "medium",
    number: 17,
    title: "Add retry/backoff to webhook dispatcher",
    created_at: new Date(Date.now() - 9000_000).toISOString(),
  },
  {
    investigation_id: "inv-fixture-001",
    reason: "Low-confidence duplicate classification (score 0.74) requires human confirmation",
    severity: "low",
    number: 9,
    title: "Duplicate of #3: crash on empty input",
    created_at: new Date(Date.now() - 86000_000).toISOString(),
  },
];

export const mockBrief: BriefResponse = {
  markdown: `# Weekly Brief\n\n## Summary\nRepository health is trending upward. Security posture remains strong.\n\n## Recommendations\n- Triage issues open longer than 30 days\n`,
  generated_at: new Date().toISOString(),
};

export const mockIssueGraph: IssueGraphResponse = {
  nodes: [
    { id: "issue-3", number: 3, title: "Login fails after v2.1", category: "open", state: "open", labels: ["auth"], engagement: 17, escalated: false },
    { id: "issue-4", number: 4, title: "Credential exposed in traceback", category: "security", state: "open", labels: ["security"], engagement: 60, escalated: true },
    { id: "issue-6", number: 6, title: "Login returns 401 after upgrade", category: "duplicate", state: "open", labels: ["auth"], engagement: 5, escalated: false },
    { id: "issue-247", number: 247, title: "Auth middleware rejects valid tokens", category: "resolved", state: "closed", labels: ["auth"], engagement: 31, escalated: false },
  ],
  links: [
    { source: "issue-3", target: "issue-6", kind: "duplicate", score: 0.96, why: "0.96 cosine similarity" },
    { source: "issue-3", target: "issue-4", kind: "similar", score: 0.78, why: "0.78 cosine similarity" },
    { source: "issue-3", target: "issue-247", kind: "reference", score: 1, why: "#3 references #247" },
  ],
  stats: { node_count: 4, link_count: 3 },
};

function codeNode(
  id: string,
  symbol: string,
  filePath: string,
  kind: string,
  cluster: string,
  x: number,
  y: number,
  z: number,
  status: CodeGraphNode["impact_status"] = "unaffected",
  distance: number | null = null,
): CodeGraphNode {
  return {
    id,
    qualname: `${filePath}::${symbol}`,
    symbol_name: symbol,
    file_path: filePath,
    kind,
    runtime: filePath.startsWith("dashboard/") ? "browser" : "python",
    language: filePath.endsWith(".py") ? "python" : "typescript",
    start_line: 1,
    end_line: 24,
    cluster_label: cluster,
    in_degree: 1,
    out_degree: 1,
    hub_score: 0.08,
    x2d: x,
    y2d: y,
    x3d: x,
    y3d: y,
    z3d: z,
    impact_status: status,
    impact_distance: distance,
  };
}

export const mockCodeGraph: CodeGraphResponse = {
  repository: "aryabailur/Doombot",
  // Deliberately lists two files the nodes below never mention
  // (agents/__init__.py, rag/embedder.py): the explorer's tree is built from
  // this list, and offline mode should exercise the zero-symbol case rather
  // than only the happy path.
  files: [
    "agents/__init__.py",
    "agents/triage/duplicate_detector.py",
    "agents/triage/impact_scorer.py",
    "agents/triage/security_scanner.py",
    "agents/triage_graph.py",
    "api/routes_repos.py",
    "api/schemas.py",
    "dashboard/src/components/IssueGraph.tsx",
    "dashboard/src/lib/api.ts",
    "rag/embedder.py",
    "rag/graph.py",
  ],
  nodes: [
    codeNode("code-triage", "issue_app", "agents/triage_graph.py", "graph", "agents", -10, 1, 0),
    codeNode("code-duplicate", "duplicate_detector_node", "agents/triage/duplicate_detector.py", "graph_node", "agents/triage", -7, 4, 2),
    codeNode("code-security", "security_scanner_node", "agents/triage/security_scanner.py", "graph_node", "agents/triage", -6, 0, -2),
    codeNode("code-impact", "impact_scorer_node", "agents/triage/impact_scorer.py", "graph_node", "agents/triage", -7, -4, 1),
    codeNode("code-build", "build_code_graph", "rag/graph.py", "function", "rag", 0, 0, 0, "changed", 0),
    codeNode("code-overlay", "_impact_overlay", "rag/graph.py", "function", "rag", 2, 3, 2, "changed", 0),
    codeNode("code-route", "get_code_graph", "api/routes_repos.py", "api_handler", "api", 7, 3, 1, "ripple", 1),
    codeNode("code-schema", "CodeGraphResponse", "api/schemas.py", "class", "api", 8, -1, -2, "ripple", 1),
    codeNode("code-client", "getCodeGraph", "dashboard/src/lib/api.ts", "function", "dashboard/lib", 5, -6, 2, "ripple", 2),
    codeNode("code-view", "IssueGraph", "dashboard/src/components/IssueGraph.tsx", "component", "dashboard/components", 0, -9, -1, "ripple", 2),
    codeNode("code-app", "GraphPage", "dashboard/src/App.tsx", "component", "dashboard/root", -4, -7, 2),
  ],
  links: [
    { source: "code-triage", target: "code-duplicate", edge_type: "calls", why: "issue_app calls duplicate_detector_node" },
    { source: "code-triage", target: "code-security", edge_type: "calls", why: "issue_app calls security_scanner_node" },
    { source: "code-triage", target: "code-impact", edge_type: "calls", why: "issue_app calls impact_scorer_node" },
    { source: "code-build", target: "code-overlay", edge_type: "calls", why: "build_code_graph calls _impact_overlay" },
    { source: "code-route", target: "code-build", edge_type: "calls", why: "get_code_graph calls build_code_graph" },
    { source: "code-route", target: "code-schema", edge_type: "calls", why: "get_code_graph returns CodeGraphResponse" },
    { source: "code-client", target: "code-route", edge_type: "http_calls", why: "getCodeGraph requests /api/repos/{owner}/{repo}/code-graph" },
    { source: "code-app", target: "code-view", edge_type: "renders", why: "GraphPage renders IssueGraph" },
    { source: "code-app", target: "code-client", edge_type: "calls", why: "GraphPage calls getCodeGraph" },
  ],
  stats: {
    node_count: 11,
    link_count: 9,
    cluster_count: 6,
    clusters: ["agents", "agents/triage", "rag", "api", "dashboard/lib", "dashboard/components"],
    languages: ["python", "typescript"],
    // Empty because this mock graph has nodes: the field only explains an
    // empty graph, and a value here would describe a state the mock never reaches.
    skipped_languages: [],
    attribution: "Semantic graph adapted from GraphDev (MIT) for Doombot F15.",
  },
  impact: {
    risk_level: "high",
    changed_units: ["rag/graph.py::build_code_graph", "rag/graph.py::_impact_overlay"],
    impacted_units: [
      { qualname: "api/routes_repos.py::get_code_graph", distance: 1, edge_type: "calls" },
      { qualname: "dashboard/src/lib/api.ts::getCodeGraph", distance: 2, edge_type: "http_calls" },
      { qualname: "dashboard/src/components/IssueGraph.tsx::IssueGraph", distance: 2, edge_type: "renders" },
    ],
    cluster_impact: [
      { cluster: "rag", impact_score: 1, changed_count: 2, ripple_count: 0, total_count: 2 },
      { cluster: "api", impact_score: 0.5, changed_count: 0, ripple_count: 2, total_count: 2 },
      { cluster: "dashboard/lib", impact_score: 0.5, changed_count: 0, ripple_count: 1, total_count: 1 },
    ],
    suggested_labels: ["high-impact", "rag", "api", "cross-subsystem"],
  },
};

/**
 * Offline stand-in for one source file.
 *
 * Synthesised rather than a real snapshot: the point of mock mode is that the
 * code pane renders, scrolls, and highlights a line without a network or a
 * GitHub token, which a short generated file exercises as well as a long real
 * one would.
 */
export function mockSourceFile(path: string): SourceFile {
  const content = [
    `"""${path} -- offline mock source."""`,
    "",
    "def build_code_graph(repo_name, changed_paths=None, *, files=None):",
    '    """Parse repository source into symbols and dependencies."""',
    "    source_files = files if files is not None else _fetch_code_files(repo_name)",
    "    units = []",
    "    for file_path, source in sorted(source_files.items()):",
    "        units.extend(_parse_python(file_path, source))",
    "    return {",
    '        "repository": repo_name,',
    '        "files": sorted(source_files),',
    '        "nodes": units,',
    "    }",
    "",
  ].join("\n");

  return {
    path,
    content,
    lines: content.split("\n").length,
    language: path.endsWith(".py") ? "python" : "text",
    truncated: false,
  };
}

/**
 * Offline stand-in for a search.
 *
 * Returns the same three issues regardless of query, with the intent marked
 * `understood: false` and a note saying so. That is deliberate: mock mode must
 * not imply that query understanding ran, because the whole point of the
 * `understood` flag is that a filter which never executed looks different from
 * one that matched nothing.
 */
export function mockSearch(query: string): SearchResponse {
  const results = [
    {
      number: 6499,
      title: "Performance degradation in node v22",
      state: "open",
      labels: ["performance"],
      author: "octocat",
      created_at: "2026-06-14T09:12:00Z",
      comments: 0,
      reactions: 4,
      score: 0.31,
      snippet:
        "the overall throughput is not degraded by much but the per-request latency had a visible jump after upgrading",
      rank_score: 0.244,
      agent: null,
    },
    {
      number: 6612,
      title: "compileTrust is slow for long proxy lists",
      state: "open",
      labels: [],
      author: "hubot",
      created_at: "2026-05-02T17:40:00Z",
      comments: 0,
      reactions: 0,
      score: 0.18,
      snippet: "Create a very long string with many IP addresses separated by commas",
      rank_score: 0.159,
      agent: {
        investigation_id: "8518ecf6-880e-4cd5-a221-055a28eb188b",
        decision: "no_action",
        confidence: 0.5,
        status: "done",
      },
    },
    {
      number: 6348,
      title: "Query param parsing drops values over 1000 chars",
      state: "closed",
      labels: ["bug"],
      author: "mona",
      created_at: "2026-02-19T11:05:00Z",
      comments: 3,
      reactions: 1,
      score: 0.16,
      snippet: "Remove param value if it is over 1000, currently returns undefined",
      rank_score: 0.14,
      agent: {
        investigation_id: "269912d6-0781-4fa6-980a-096ee0ca45b6",
        decision: "close_duplicate",
        confidence: 0.87,
        status: "done",
      },
    },
  ];

  return {
    repo_name: "expressjs/express",
    query,
    intent: {
      semantic_query: query,
      state: null,
      created_after: null,
      created_before: null,
      labels: [],
      author: null,
      unanswered: false,
      min_reactions: null,
      sort: "relevance",
      understood: false,
      note: "Offline mock data — the query was not interpreted.",
    },
    results,
    stats: {
      considered: results.length,
      returned: results.length,
      filter_mode: "none",
      indexed: 200,
      below_floor: 0,
    },
  };
}
