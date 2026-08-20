/**
 * AgentEngine backed by the Doombot FastAPI backend.
 *
 * This is the LLM-grade path: the backend runs the LangGraph triage graph over
 * Groq, so decisions come from a model reading the issue rather than from
 * keyword and similarity heuristics. The same nine methods, so the UI is
 * unchanged (spec section 43).
 *
 * The two sides speak different dialects -- the API is snake_case with its own
 * evidence and decision vocabulary (see api/schemas.py), the extension is
 * camelCase (src/lib/types.ts) -- so every response passes through an explicit
 * mapper below. Nothing is spread through blindly: a silent shape mismatch
 * would surface as a blank card rather than an error.
 *
 * Anything the backend does not expose (repository memory grouping, PR risk,
 * grounded Ask) falls back to the live GitHub engine rather than being
 * fabricated here.
 */

import type {
  ActivitySummary,
  AgentEvent,
  AgentRunState,
  Decision,
  DuplicateResult,
  EvidenceSource,
  GroundedAnswer,
  HealthReport,
  Insight,
  Investigation,
  IssueRecord,
  PRReview,
  RepositoryContext,
  RepositoryMemory,
} from '@/lib/types'

import type {
  AgentEngine,
  IssueInput,
  PullRequestInput,
  QuestionInput,
  RepositoryInput,
} from './AgentEngine'
import { GitHubError } from './GitHubClient'
import { LiveAgentEngine } from './LiveAgentEngine'

/** api/schemas.py Evidence */
type ApiEvidence = {
  type: 'issue' | 'pr' | 'file' | 'rule'
  ref: string
  score: number | null
  snippet: string
}

/** api/schemas.py StepRecord */
type ApiStep = {
  step_id: string
  seq: number
  name: string
  title: string
  status: 'running' | 'done' | 'error'
  input_summary: string
  output_summary: string
  evidence: ApiEvidence[]
  duration_ms: number
  started_at: string
  ended_at: string | null
}

/** api/schemas.py InvestigationDetail */
type ApiInvestigation = {
  investigation_id: string
  repo_name: string
  kind: 'issue' | 'pr'
  number: number
  title: string
  status: string
  decision: string | null
  created_at: string
  completed_at: string | null
  steps: ApiStep[]
  decision_reason: string | null
  confidence: number | null
  impact_score: number | null
}

type ApiHealth = {
  score: number
  breakdown: { security: number; staleness: number; duplication: number; responsiveness: number }
  history: Array<{ ts: string; score: number }>
}

/**
 * The backend's node names, in graph order, mapped to the UI's state machine.
 *
 * The triage graph has six nodes; the UI's AgentRunState has ten values. The
 * mapping is deliberate rather than positional so that adding a node to the
 * graph cannot silently shift every subsequent step's rendered state.
 */
const NODE_STATE: Record<string, AgentRunState> = {
  issue_fetcher: 'reading',
  duplicate_detector: 'retrieving',
  resolver: 'comparing',
  security_scanner: 'checking_precedent',
  impact_scorer: 'assessing_impact',
  labeler: 'assessing_impact',
  decider: 'deciding',
}

/** The backend's decider actions mapped to the UI's four decisions. */
const ACTION_DECISION: Record<string, Decision> = {
  escalate: 'escalate',
  comment: 'follow_up',
  close_duplicate: 'duplicate',
  resolve: 'follow_up',
  no_action: 'silent',
}

function evidenceType(type: ApiEvidence['type']): EvidenceSource['type'] {
  // The API's "pr" is the UI's "pull_request"; "file" and "rule" have no UI
  // equivalent and are shown as decisions, which is how the panel renders
  // non-issue provenance.
  if (type === 'issue') return 'issue'
  if (type === 'pr') return 'pull_request'
  return 'decision'
}

function toEvidence(repoName: string, item: ApiEvidence): EvidenceSource {
  const isIssue = item.type === 'issue'
  const isPull = item.type === 'pr'
  return {
    id: isIssue ? `#${item.ref}` : isPull ? `PR #${item.ref}` : item.ref,
    type: evidenceType(item.type),
    title: item.snippet || item.ref,
    url:
      isIssue || isPull
        ? `https://github.com/${repoName}/${isPull ? 'pull' : 'issues'}/${item.ref}`
        : undefined,
    score: item.score ?? undefined,
    reason: item.snippet || `${item.type} evidence`,
  }
}

function toAgentEvents(run: ApiInvestigation): AgentEvent[] {
  const repoName = run.repo_name
  const events: AgentEvent[] = [
    {
      id: `${run.investigation_id}-queued`,
      runId: run.investigation_id,
      state: 'queued',
      title: 'Investigation queued',
      detail: `Backend run for #${run.number}.`,
      timestamp: run.created_at,
    },
  ]

  for (const step of run.steps) {
    events.push({
      id: step.step_id,
      runId: run.investigation_id,
      state: step.status === 'error' ? 'failed' : (NODE_STATE[step.name] ?? 'comparing'),
      title: step.title,
      detail: step.output_summary,
      sources: step.evidence.map((item) => toEvidence(repoName, item)),
      timestamp: step.ended_at ?? step.started_at,
    })
  }

  if (run.status === 'done' && run.decision !== 'error') {
    events.push({
      id: `${run.investigation_id}-complete`,
      runId: run.investigation_id,
      state: 'completed',
      title: 'Investigation complete',
      detail: run.decision_reason ?? 'Decision recorded.',
      timestamp: run.completed_at ?? run.created_at,
    })
  }

  return events
}

/**
 * Human-readable decision factors.
 *
 * Built from the semantic parts of the run -- matched security keywords, the
 * related issues found, the model's classification confidence -- rather than
 * from raw snippets, which are mid-sentence slices of the issue body and read
 * as truncated noise in a UI card.
 */
function buildFactors(run: ApiInvestigation): string[] {
  const factors: string[] = []

  const keywords = run.steps
    .filter((step) => step.name === 'security_scanner')
    .flatMap((step) => step.evidence)
    .filter((item) => item.type === 'rule' && item.ref !== 'llm_confirmation')
    .map((item) => item.ref)
  if (keywords.length > 0) {
    factors.push(`Security-sensitive terms: ${[...new Set(keywords)].slice(0, 4).join(', ')}`)
  }

  const related = run.steps
    .filter((step) => step.name === 'duplicate_detector')
    .flatMap((step) => step.evidence)
    .filter((item) => item.type === 'issue')
  for (const item of related.slice(0, 2)) {
    const score = item.score === null ? '' : ` at ${Math.round(item.score * 100)}%`
    factors.push(`Related to #${item.ref}${score}`)
  }

  const classification = run.steps
    .flatMap((step) => step.evidence)
    .find((item) => item.ref === 'classification')
  if (classification?.score != null) {
    factors.push(`Classified with ${Math.round(classification.score * 100)}% confidence`)
  }

  if (run.impact_score != null) {
    factors.push(`Impact scored ${Math.round(run.impact_score)}/100`)
  }

  return factors.slice(0, 4)
}

function toInsight(run: ApiInvestigation): Insight {
  // Only issue/PR evidence reaches the chips: "rule" items are the impact
  // scorer's and labeler's internal arithmetic (base=5, auto_apply_threshold),
  // which is provenance for the trace, not something a maintainer can open.
  // Deduplicated by id because several nodes cite the same issue.
  const seen = new Set<string>()
  const evidence: EvidenceSource[] = []
  for (const step of run.steps) {
    for (const item of step.evidence) {
      if (item.type !== 'issue' && item.type !== 'pr') continue
      const mapped = toEvidence(run.repo_name, item)
      if (seen.has(mapped.id)) continue
      seen.add(mapped.id)
      evidence.push(mapped)
    }
  }
  const decision = ACTION_DECISION[run.decision ?? ''] ?? 'silent'
  // The backend reports 0-1 confidence; absent means the graph errored before
  // the decider ran, and no number should be invented for that.
  const confidence = run.confidence ?? 0

  return {
    title:
      decision === 'escalate'
        ? 'Escalate'
        : decision === 'duplicate'
          ? 'Duplicate'
          : decision === 'follow_up'
            ? 'Needs information'
            : 'Stay silent',
    summary: run.decision_reason ?? 'The backend completed without a stated reason.',
    confidence,
    decision,
    evidence,
    // Rule evidence carries a semantic `ref` (the matched keyword, the score
    // component) with a raw body excerpt as its snippet. The ref is the
    // readable factor; the snippet is a mid-sentence fragment of the issue.
    factors: buildFactors(run),
    suggestedAction: run.decision_reason ?? 'Review the investigation trace.',
    // Below the backend's own escalation bar with nothing cited: say so rather
    // than presenting a weak model result as a finding.
    insufficientEvidence: evidence.length === 0 && confidence < 0.5,
  }
}

export class BackendAgentEngine implements AgentEngine {
  /** Live GitHub engine, used for what the backend does not expose. */
  private readonly fallback: LiveAgentEngine

  constructor(
    private readonly baseUrl: string,
    githubToken?: string,
  ) {
    this.fallback = new LiveAgentEngine(githubToken)
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init?.headers },
      })
    } catch {
      throw new GitHubError(
        `RepoGuardian backend is unreachable at ${this.baseUrl}.`,
        0,
        true,
      )
    }
    if (!response.ok) {
      throw new GitHubError(`Backend returned ${response.status}.`, response.status, true)
    }
    return (await response.json()) as T
  }

  /**
   * Start an investigation and wait for the graph to finish.
   *
   * POST returns an id immediately -- the graph takes ~10s of GitHub and model
   * calls -- so this polls the detail endpoint. The dashboard follows the
   * WebSocket instead; a content script polling a few times is simpler and
   * avoids holding a socket open across GitHub's SPA navigations.
   */
  private async runInvestigation(
    repoName: string,
    kind: 'issue' | 'pr',
    number: number,
  ): Promise<ApiInvestigation> {
    const { investigation_id: id } = await this.request<{ investigation_id: string }>(
      '/api/investigations',
      { method: 'POST', body: JSON.stringify({ repo_name: repoName, kind, number }) },
    )

    const deadline = Date.now() + 45_000
    let delay = 400
    for (;;) {
      const run = await this.request<ApiInvestigation>(`/api/investigations/${id}`)
      if (run.status === 'done' || run.status === 'error') return run
      if (Date.now() > deadline) {
        throw new GitHubError('The backend investigation did not finish in time.', 504, true)
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 1.4, 2_000)
    }
  }

  async getRepositoryContext(input: RepositoryInput): Promise<RepositoryContext> {
    // Issue/PR counts and contributors come from GitHub; the backend's health
    // score replaces the locally computed one.
    const [context, health] = await Promise.all([
      this.fallback.getRepositoryContext(input),
      this.getRepositoryHealth(input).catch(() => null),
    ])
    return health ? { ...context, healthScore: health.score } : context
  }

  async getIssueInsight(input: IssueInput): Promise<Insight> {
    return toInsight(await this.runInvestigation(`${input.owner}/${input.repo}`, 'issue', input.issueNumber))
  }

  async investigateIssue(input: IssueInput): Promise<Investigation> {
    const repoName = `${input.owner}/${input.repo}`
    const run = await this.runInvestigation(repoName, 'issue', input.issueNumber)

    if (run.decision === 'error') {
      // A failed graph run is not a decision. Surfacing it as one would show a
      // fabricated verdict for a run that never reached the decider.
      throw new GitHubError(
        run.decision_reason ?? 'The backend investigation failed.',
        502,
        true,
      )
    }

    const issue: IssueRecord = {
      number: run.number,
      title: run.title,
      body: '',
      subsystem: 'backend analysis',
      labels: [],
      symptoms: [],
    }

    return {
      runId: run.investigation_id,
      issue,
      insight: toInsight(run),
      events: toAgentEvents(run),
    }
  }

  async getRepositoryHealth(input: RepositoryInput): Promise<HealthReport> {
    const health = await this.request<ApiHealth>(
      `/api/repos/${input.owner}/${input.repo}/health`,
    )
    const { breakdown } = health
    return {
      score: Math.round(health.score),
      interpretation: `Backend health scoring: responsiveness ${Math.round(breakdown.responsiveness)}, staleness ${Math.round(breakdown.staleness)}, duplication ${Math.round(breakdown.duplication)}, security ${Math.round(breakdown.security)}.`,
      metrics: [
        { label: 'Responsiveness', value: String(Math.round(breakdown.responsiveness)), change: 'of 100', direction: 'up', concern: breakdown.responsiveness < 50 },
        { label: 'Staleness', value: String(Math.round(breakdown.staleness)), change: 'of 100', direction: 'up', concern: breakdown.staleness < 50 },
        { label: 'Duplication', value: String(Math.round(breakdown.duplication)), change: 'of 100', direction: 'up', concern: breakdown.duplication < 50 },
        { label: 'Security', value: String(Math.round(breakdown.security)), change: 'of 100', direction: 'up', concern: breakdown.security < 50 },
      ],
      evidence: [],
    }
  }

  // --- Not exposed by the backend: served by the live GitHub engine ---------
  //
  // Delegating is the honest option. The alternative is inventing a shape the
  // backend never returned.

  async reviewPullRequest(input: PullRequestInput): Promise<PRReview> {
    return this.fallback.reviewPullRequest(input)
  }

  async findDuplicates(input: IssueInput): Promise<DuplicateResult[]> {
    return this.fallback.findDuplicates(input)
  }

  async getRepositoryMemory(input: RepositoryInput): Promise<RepositoryMemory> {
    return this.fallback.getRepositoryMemory(input)
  }

  async getActivity(input: RepositoryInput): Promise<ActivitySummary> {
    return this.fallback.getActivity(input)
  }

  async answerQuestion(input: QuestionInput): Promise<GroundedAnswer> {
    return this.fallback.answerQuestion(input)
  }
}
