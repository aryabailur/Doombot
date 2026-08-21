export type Decision = 'escalate' | 'silent' | 'follow_up' | 'duplicate'

export type EvidenceSource = {
  id: string
  type: 'issue' | 'pull_request' | 'commit' | 'discussion' | 'file' | 'decision'
  title: string
  url?: string
  score?: number
  reason: string
  subsystem?: string
  labels?: string[]
}

export type Insight = {
  title: string
  summary: string
  confidence: number
  decision: Decision
  evidence: EvidenceSource[]
  factors: string[]
  suggestedAction: string
  insufficientEvidence?: boolean
}

export type RepositoryContext = {
  owner: string
  repo: string
  branch?: string
  openIssues: number
  openPullRequests: number
  activeContributors: number
  avgResponseHours: number
  duplicateRate: number
  healthScore: number
}

export type GitHubContext =
  | { type: 'repository'; owner: string; repo: string }
  | { type: 'issue'; owner: string; repo: string; issueNumber: number }
  | { type: 'pull_request'; owner: string; repo: string; pullNumber: number }
  | { type: 'unknown' }

export type AgentRunState =
  | 'queued'
  | 'reading'
  | 'retrieving'
  | 'comparing'
  | 'checking_precedent'
  | 'assessing_impact'
  | 'deciding'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'

export type AgentEvent = {
  id: string
  timestamp: string
  runId: string
  state: AgentRunState
  title: string
  detail?: string
  sources?: EvidenceSource[]
}

export type IssueRecord = {
  number: number
  title: string
  body: string
  subsystem: string
  labels: string[]
  environment?: string
  symptoms: string[]
}

export type PullRequestRecord = {
  number: number
  title: string
  files: string[]
  subsystem: string
}

export type Investigation = {
  runId: string
  issue: IssueRecord
  insight: Insight
  events: AgentEvent[]
  approval?: ApprovalAction
}

export type DuplicateResult = {
  issue: EvidenceSource
  similarity: number
  sameComponent: string
  sameSymptom: string
  sameEnvironment?: string
  canonical: boolean
}

export type PRReview = {
  pullRequest: PullRequestRecord
  risk: 'low' | 'moderate' | 'high'
  confidence: number
  summary: string
  path: string[]
  evidence: EvidenceSource[]
}

export type HealthMetric = {
  label: string
  value: string
  change: string
  direction: 'up' | 'down'
  concern: boolean
}

export type HealthReport = {
  score: number
  interpretation: string
  metrics: HealthMetric[]
  evidence: EvidenceSource[]
}

export type GroundedAnswer = {
  answer: string
  confidence: number
  evidence: EvidenceSource[]
  suggestedAction: string
}

export type MemoryGroup = {
  subsystem: string
  items: EvidenceSource[]
}

export type RepositoryMemory = {
  indexed: {
    commits: number
    issues: number
    pullRequests: number
    contributors: number
  }
  groups: MemoryGroup[]
  policy?: RepositoryPolicy
}

export type FixReceipt = {
  command: string[]
  exitCode: number
  durationMs: number
  stdout: string
  stderr: string
  containerized: boolean
  networkDisabled: boolean
  image: string
  imageDigest: string
}

export type FixRun = {
  id: string
  investigationId: string
  repository: string
  issueNumber: number
  status: 'queued' | 'preparing' | 'generating' | 'verifying' | 'proposed' | 'failed' | 'approved' | 'rejected' | 'publishing' | 'published'
  baseSha?: string
  summary?: string
  patch?: string
  commands: string[][]
  receipts: FixReceipt[]
  error?: string
}

export type RepositoryPolicyProfile = {
  action: string
  samples: number
  approvals: number
  rejections: number
  approvalRate: number
  guidance: 'observing' | 'caution' | 'mixed' | 'aligned'
}

export type RepositoryPolicy = {
  mode: 'observing' | 'learned'
  minimumSamples: number
  totalDecisions: number
  approvals: number
  rejections: number
  approvalRate?: number
  actions: RepositoryPolicyProfile[]
  learnedRules: string[]
  updatedAt?: string
}

export type ActivitySummary = {
  source: 'demo' | 'github' | 'backend'
  automatedCount: number
  attentionCount: number
  items: Array<{
    issueNumber: number
    title: string
    confidence?: number
    severity: 'critical' | 'warning'
  }>
}

export type ApprovalAction = {
  id: string
  kind: 'add_label' | 'post_comment' | 'link_issue' | 'request_information' | 'github_update'
  title: string
  detail: string
  reason: string
  evidence: EvidenceSource[]
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'verified' | 'failed'
  result?: Record<string, unknown>
  error?: string
  live?: boolean
}

export type DecisionFeedback = {
  issueNumber: number
  useful: boolean
  reason?: 'wrong_duplicate' | 'wrong_priority' | 'missing_evidence' | 'other'
  createdAt: string
}

export type DemoState = {
  approvals: Record<string, ApprovalAction['status']>
  feedback: DecisionFeedback[]
}

/**
 * One entry in the live agent activity feed.
 *
 * Flattened from the backend's four WebSocket envelope types so the UI renders
 * one list rather than branching on transport shapes.
 */
export type AgentActivityEvent = {
  id: string
  kind: 'connection' | 'activity' | 'step' | 'decision'
  message: string
  timestamp: string
  severity: 'info' | 'warning' | 'error'
  repository?: string
  investigationId?: string
  state?: AgentRunState
  durationMs?: number
  /** True for a step that has started but not yet reported completion. */
  running?: boolean
}

export type LensSettings = {
  /** false = live GitHub analysis. Demo stays the default (spec section 40). */
  demoMode: boolean
  /** Optional PAT. Raises the rate limit; never bundled (spec section 42). */
  githubToken?: string
  /** Optional RepoGuardian backend origin, e.g. http://localhost:8000. */
  backendUrl?: string
}

export type ExtensionMessage =
  | { type: 'GET_REPOSITORY_CONTEXT'; owner: string; repo: string }
  | { type: 'GET_ISSUE_INSIGHT'; owner: string; repo: string; issueNumber: number }
  | { type: 'RUN_INVESTIGATION'; owner: string; repo: string; issueNumber: number }
  | { type: 'GET_ACTIVITY'; owner: string; repo: string }
  | { type: 'GET_REPOSITORY_MEMORY'; owner: string; repo: string }
  | { type: 'ASK_AGENT'; owner: string; repo: string; question: string; context?: GitHubContext }
  | { type: 'GET_DUPLICATES'; owner: string; repo: string; issueNumber: number }
  | { type: 'GET_PR_REVIEW'; owner: string; repo: string; pullNumber: number }
  | { type: 'GET_HEALTH'; owner: string; repo: string }
  | { type: 'APPROVE_ACTION'; action: ApprovalAction; approved: boolean }
  | { type: 'START_FIX_RUN'; investigationId: string }
  | { type: 'DECIDE_FIX_RUN'; runId: string; approved: boolean }
  | { type: 'RECORD_FEEDBACK'; feedback: DecisionFeedback }
  | { type: 'GET_AGENT_ACTIVITY'; owner?: string; repo?: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; settings: Partial<LensSettings> }
  | { type: 'RESET_DEMO' }
  | { type: 'TOGGLE_LENS' }

export type ExtensionResponse<T> =
  /**
   * `degraded` marks a live request that fell back to seeded data; `notice`
   * carries the reason so the panel can say so rather than pass demo results
   * off as live ones.
   */
  | { ok: true; data: T; degraded?: boolean; notice?: string }
  | { ok: false; error: string; recoverable: boolean }

export type LensView = 'overview' | 'investigation' | 'memory' | 'agent' | 'ask' | 'pr'
