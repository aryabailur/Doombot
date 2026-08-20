// Realistic seed data for RepoGuardian's demo mode.
// Repository: acme/payments-api

export type Decision = "escalate" | "silent" | "followup" | "duplicate" | "insufficient";

export interface EvidenceRef {
  id: string;
  label: string;
  kind: "issue" | "pr" | "decision" | "commit";
  similarity?: number;
  relevance?: number;
  /** Real evidence.score from the backend, regardless of kind — unlike
   * similarity/relevance (only set for RAG-style issue/pr/duplicate
   * matches), this is populated for every real evidence type (security,
   * impact, etc) so overall evidence strength can be computed honestly.
   * Optional because seed/demo fixtures predate this field. */
  score?: number;
}

export interface AgentStep {
  seq: number;
  name: string;
  title: string;
  detail: string;
  sources?: EvidenceRef[];
  status: "done" | "running" | "error";
  ts: string;
  toolCalls?: string[];
}

export interface Investigation {
  id: string;
  number: number;
  title: string;
  kind: "issue" | "pr";
  author: string;
  body: string;
  labels: string[];
  createdAt: string;
  decision: Decision;
  confidence: number;
  reason: string;
  category: string;
  evidence: EvidenceRef[];
  steps: AgentStep[];
  needsAttention: boolean;
  severity?: "low" | "medium" | "high" | "critical";
  missingInfo?: string[];
}

export const REPO = {
  fullName: "acme/payments-api",
  owner: "acme",
  name: "payments-api",
  maintainer: "Maya Chen",
  openIssues: 128,
  openPRs: 17,
  contributors: 67,
  avgResponseHours: 4.2,
  avgResponseTrend: 31,
  duplicateRate: 23,
  duplicateTrend: -4,
  healthScore: 82,
  healthLabel: "Healthy with signals",
};

export const HEALTH_HISTORY = [
  { ts: "2026-07-21", backlog: 108, response: 3.1, duplicate: 27, contributors: 74 },
  { ts: "2026-07-28", backlog: 112, response: 3.3, duplicate: 26, contributors: 73 },
  { ts: "2026-08-04", backlog: 116, response: 3.5, duplicate: 25, contributors: 71 },
  { ts: "2026-08-11", backlog: 120, response: 3.8, duplicate: 24, contributors: 70 },
  { ts: "2026-08-14", backlog: 123, response: 4.0, duplicate: 23, contributors: 68 },
  { ts: "2026-08-17", backlog: 126, response: 4.1, duplicate: 23, contributors: 67 },
  { ts: "2026-08-20", backlog: 128, response: 4.2, duplicate: 23, contributors: 67 },
];

export const INVESTIGATIONS: Investigation[] = [
  {
    id: "inv-482",
    number: 482,
    title: "OAuth refresh tokens randomly expiring",
    kind: "issue",
    author: "@jrodriguez",
    body: "Since upgrading to v2.4, users are reporting that their session gets randomly logged out even though the refresh token should still be valid. Seeing this across multiple environments.",
    labels: ["authentication", "bug"],
    createdAt: "2026-08-20T11:52:00Z",
    decision: "escalate",
    confidence: 0.94,
    reason:
      "Likely regression in token rotation after the v2.4 authentication refactor. Same subsystem as two recent incidents, and matches a maintainer precedent for escalating token-lifecycle failures.",
    category: "Security · Authentication",
    evidence: [
      { id: "331", label: "OAuth tokens expire after 60 min", kind: "issue", similarity: 0.91 },
      { id: "402", label: "Refresh token expires after retry", kind: "issue", similarity: 0.84 },
      { id: "417", label: "Authentication session instability", kind: "issue", similarity: 0.76 },
      { id: "188", label: "Fix refresh token rotation after auth refactor", kind: "pr", relevance: 0.87 },
      { id: "7f92ab1", label: "token rotation rewrite", kind: "commit" },
    ],
    steps: [
      {
        seq: 1,
        name: "classify",
        title: "Classify issue",
        detail: "Authentication / token lifecycle — 96% classification confidence.",
        status: "done",
        ts: "17:32:14",
      },
      {
        seq: 2,
        name: "retrieve",
        title: "Search project memory",
        detail: "Retrieved 17 historical issues, 6 pull requests, 2 maintainer decisions.",
        sources: [
          { id: "331", label: "OAuth tokens expire after 60 min", kind: "issue", similarity: 0.91 },
          { id: "402", label: "Refresh token expires after retry", kind: "issue", similarity: 0.84 },
        ],
        status: "done",
        ts: "17:32:16",
      },
      {
        seq: 3,
        name: "compare",
        title: "Compare historical cases",
        detail: "#331 at 91% similarity, #402 at 84%, #417 at 76%.",
        status: "done",
        ts: "17:32:18",
      },
      {
        seq: 4,
        name: "precedent",
        title: "Check maintainer precedent",
        detail: "PR #188 previously fixed token rotation after an auth refactor — same trigger pattern.",
        sources: [{ id: "188", label: "Fix refresh token rotation after auth refactor", kind: "pr", relevance: 0.87 }],
        status: "done",
        ts: "17:32:20",
      },
      {
        seq: 5,
        name: "impact",
        title: "Assess impact",
        detail: "14 reports in 6 hours, all in the authentication subsystem.",
        status: "done",
        ts: "17:32:22",
      },
      {
        seq: 6,
        name: "decide",
        title: "Decision",
        detail: "ESCALATE — 94% confidence.",
        status: "done",
        ts: "17:32:23",
      },
    ],
    needsAttention: true,
    severity: "critical",
  },
  {
    id: "inv-491",
    number: 491,
    title: "Rate limit reached after retry",
    kind: "issue",
    author: "@alexdev",
    body: "Getting 429s consistently on retry even after backing off. Not sure if this is client-side or server-side throttling.",
    labels: ["needs-info"],
    createdAt: "2026-08-20T09:14:00Z",
    decision: "followup",
    confidence: 0.81,
    reason:
      "The agent needs reproduction steps and environment details before it can compare this against historical rate-limiting reports.",
    category: "Reliability",
    evidence: [
      { id: "271", label: "429 errors under burst traffic", kind: "issue", similarity: 0.68 },
      { id: "303", label: "Retry backoff not respecting Retry-After header", kind: "issue", similarity: 0.61 },
    ],
    steps: [
      {
        seq: 1,
        name: "classify",
        title: "Classify issue",
        detail: "Reliability / rate limiting — 89% classification confidence.",
        status: "done",
        ts: "17:32:44",
      },
      {
        seq: 2,
        name: "retrieve",
        title: "Search project memory",
        detail: "Found 2 related historical reports, both below the duplicate threshold.",
        sources: [
          { id: "271", label: "429 errors under burst traffic", kind: "issue", similarity: 0.68 },
        ],
        status: "done",
        ts: "17:32:46",
      },
      {
        seq: 3,
        name: "gap-check",
        title: "Check for missing information",
        detail: "No Node.js version, request frequency, or reproduction steps provided.",
        status: "done",
        ts: "17:32:49",
      },
      {
        seq: 4,
        name: "decide",
        title: "Decision",
        detail: "NEEDS INFORMATION — requested reproduction details from @alexdev.",
        status: "done",
        ts: "17:32:50",
      },
    ],
    needsAttention: true,
    severity: "medium",
    missingInfo: ["reproduction steps", "Node.js version", "request frequency"],
  },
  {
    id: "inv-477",
    number: 477,
    title: "Database migration hangs",
    kind: "issue",
    author: "@priyanka-dev",
    body: "The migration for the ledger table partitioning seems to hang indefinitely on staging. No error, just spins.",
    labels: ["database", "regression"],
    createdAt: "2026-08-20T08:03:00Z",
    decision: "escalate",
    confidence: 0.76,
    reason:
      "Matches the shape of a lock-contention regression seen twice before during large-table migrations; impact is currently limited to staging but the pattern historically preceded a production incident.",
    category: "Reliability · Database",
    evidence: [
      { id: "298", label: "Migration lock timeout on large tables", kind: "issue", similarity: 0.71 },
      { id: "192", label: "Improve issue triage workflow", kind: "pr", relevance: 0.4 },
    ],
    steps: [
      {
        seq: 1,
        name: "classify",
        title: "Classify issue",
        detail: "Database / migrations — 84% classification confidence.",
        status: "done",
        ts: "17:31:02",
      },
      {
        seq: 2,
        name: "retrieve",
        title: "Search project memory",
        detail: "Retrieved 4 historical migration issues.",
        status: "done",
        ts: "17:31:05",
      },
      {
        seq: 3,
        name: "impact",
        title: "Assess impact",
        detail: "Currently staging-only; historical pattern suggests production risk within days.",
        status: "done",
        ts: "17:31:09",
      },
      {
        seq: 4,
        name: "decide",
        title: "Decision",
        detail: "ESCALATE — 76% confidence.",
        status: "done",
        ts: "17:31:10",
      },
    ],
    needsAttention: true,
    severity: "high",
  },
  {
    id: "inv-476",
    number: 476,
    title: "Windows install fails on fresh install",
    kind: "issue",
    author: "@newcontributor22",
    body: "npm install fails on Windows with an EPERM error on a fresh clone.",
    labels: ["installer", "windows"],
    createdAt: "2026-08-19T22:10:00Z",
    decision: "silent",
    confidence: 0.88,
    reason: "Known issue. Already resolved by PR #72. No new evidence of regression.",
    category: "Installer",
    evidence: [
      { id: "331b", label: "Windows installer requires admin rights", kind: "issue", similarity: 0.87 },
      { id: "72", label: "Fix Windows installer requirements", kind: "pr", relevance: 0.92 },
    ],
    steps: [
      {
        seq: 1,
        name: "retrieve",
        title: "Search project memory",
        detail: "Found an identical historical report resolved by PR #72.",
        status: "done",
        ts: "17:28:40",
      },
      {
        seq: 2,
        name: "compare",
        title: "Compare against resolution",
        detail: "Symptoms match the known fix exactly; no new stack trace elements.",
        status: "done",
        ts: "17:28:41",
      },
      {
        seq: 3,
        name: "decide",
        title: "Decision",
        detail: "STAY SILENT — 88% confidence. Maintainer interruption avoided.",
        status: "done",
        ts: "17:28:42",
      },
    ],
    needsAttention: false,
  },
  {
    id: "inv-495",
    number: 495,
    title: "Application freezes after changing configuration",
    kind: "issue",
    author: "@mikael",
    body: "UI becomes unresponsive after saving settings. Have to force-refresh.",
    labels: ["ui", "duplicate"],
    createdAt: "2026-08-19T20:44:00Z",
    decision: "duplicate",
    confidence: 0.94,
    reason: "94% semantic match with #382, already tracked. No new maintainer interruption needed.",
    category: "UI",
    evidence: [
      { id: "382", label: "UI hangs when changing config", kind: "issue", similarity: 0.94 },
      { id: "401", label: "Settings page becomes unresponsive", kind: "issue", similarity: 0.82 },
    ],
    steps: [
      {
        seq: 1,
        name: "retrieve",
        title: "Search project memory",
        detail: "17 candidate issues found in the settings/UI cluster.",
        status: "done",
        ts: "17:32:14",
      },
      {
        seq: 2,
        name: "compare",
        title: "Compare candidates",
        detail: "#382 at 94%, #401 at 82%.",
        status: "done",
        ts: "17:32:16",
      },
      {
        seq: 3,
        name: "decide",
        title: "Decision",
        detail: "DUPLICATE of #382 — 94% confidence.",
        status: "done",
        ts: "17:32:18",
      },
    ],
    needsAttention: false,
  },
  {
    id: "inv-489",
    number: 489,
    title: "UI freezes after settings change",
    kind: "issue",
    author: "@lchen",
    body: "Similar to another report but happens on a slightly different screen.",
    labels: ["ui"],
    createdAt: "2026-08-19T18:02:00Z",
    decision: "insufficient",
    confidence: 0.42,
    reason:
      "I found related reports but cannot establish that they share the same underlying bug. The stack trace differs from #371's known cause.",
    category: "UI",
    evidence: [{ id: "371", label: "Settings screen unresponsive after save", kind: "issue", similarity: 0.58 }],
    steps: [
      {
        seq: 1,
        name: "retrieve",
        title: "Search project memory",
        detail: "One related report found, but similarity is below the confident-duplicate threshold.",
        status: "done",
        ts: "17:20:05",
      },
      {
        seq: 2,
        name: "decide",
        title: "Decision",
        detail: "INSUFFICIENT EVIDENCE — 42% confidence. Not escalated, not closed.",
        status: "done",
        ts: "17:20:07",
      },
    ],
    needsAttention: false,
  },
];

export const ACTIVITY_LOG = [
  {
    ts: "12:41:09",
    kind: "investigating" as const,
    title: "Checking #495 for duplicates...",
    detail: "Searching project memory — 17 candidates found",
  },
  {
    ts: "12:40:51",
    kind: "silent" as const,
    title: "#489 marked duplicate — no escalation",
    detail: "93% match with #371",
  },
  {
    ts: "12:40:23",
    kind: "investigating" as const,
    title: "Searching historical decisions for #491",
    detail: "2 related reports found",
  },
  {
    ts: "12:39:57",
    kind: "action" as const,
    title: "Requested reproduction environment from @alexdev",
    detail: "Missing: Node.js version, request frequency, reproduction steps",
  },
  {
    ts: "12:38:11",
    kind: "escalated" as const,
    title: "#482 escalated — security-sensitive auth issue",
    detail: "94% confidence · 3 historical matches · 1 maintainer precedent",
  },
  {
    ts: "12:34:51",
    kind: "action" as const,
    title: "#476 labeled duplicate",
    detail: "Approved automation rule",
  },
  {
    ts: "12:30:02",
    kind: "silent" as const,
    title: "#481 closed — insufficient evidence",
    detail: "No pattern match strong enough to act on",
  },
];

export const CONTRIBUTORS = [
  { name: "Maya Chen", handle: "@mayachen", mergedPRs: 18, role: "Maintainer" },
  { name: "Alex Rivera", handle: "@alexdev", openPRs: 7, unresolved: 2 },
  { name: "Priya Shah", handle: "@priyanka-dev", firstContribution: true },
  { name: "J. Rodriguez", handle: "@jrodriguez", mergedPRs: 4 },
];

export const KNOWLEDGE_MAP = {
  categories: [
    { name: "Authentication", count: 34, refs: ["#331", "#402", "#417", "#482", "PR #188"] },
    { name: "Payments", count: 61, refs: ["#298", "#356"] },
    { name: "Database", count: 28, refs: ["#298", "#477"] },
    { name: "Infrastructure", count: 19, refs: ["#271", "#303"] },
    { name: "API", count: 40, refs: ["#382", "#401", "#495"] },
  ],
  stats: {
    commits: 2418,
    issues: 483,
    prs: 219,
    contributors: 67,
    decisions: 42,
  },
};

export const WEEKLY_BRIEF = {
  weekLabel: "Week 34 · Aug 17–23",
  analyzed: 143,
  escalated: 3,
  handled: 125,
  followups: 2,
  duplicates: 27,
  narrative:
    "This week was quieter than the previous one, but authentication-related issues increased. The agent detected a possible regression around token rotation and surfaced it for review.",
  evidence: ["482", "331", "402", "188"],
  watchNext: ["Authentication", "Response time", "Database migrations"],
};
