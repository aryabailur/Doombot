import type {
  RepoSummary,
  HealthResponse,
  InvestigationSummary,
  InvestigationDetail,
  Escalation,
  BriefResponse,
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
