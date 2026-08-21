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
  ApprovalAction,
  Decision,
  DuplicateResult,
  EvidenceSource,
  FixRun,
  GroundedAnswer,
  HealthReport,
  Insight,
  Investigation,
  IssueRecord,
  PRReview,
  RepositoryContext,
  RepositoryMemory,
  RepositoryPolicy,
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
type ApiInvestigationSummary = {
  investigation_id: string
  repo_name: string
  kind: 'issue' | 'pr'
  number: number
  title: string
  status: string
  decision: string | null
  created_at: string
  completed_at: string | null
}

type ApiInvestigation = ApiInvestigationSummary & {
  steps: ApiStep[]
  decision_reason: string | null
  confidence: number | null
  impact_score: number | null
  proposed_action?: ApiProposedAction | null
}

type ApiEscalation = {
  investigation_id: string
  reason: string
  severity: string
  number: number
  title: string
  created_at: string
}

type ApiProposedAction = {
  id: string
  investigation_id: string
  repo_name: string
  issue_number: number
  action: string
  comment: string | null
  labels: string[]
  status: ApprovalAction['status']
  decided_by: string | null
  decision_note: string | null
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
  decided_at: string | null
  executed_at: string | null
}

type ApiHealth = {
  score: number
  breakdown: { security: number; staleness: number; duplication: number; responsiveness: number }
  history: Array<{ ts: string; score: number }>
  measured?: boolean
  issue_count?: number
  unreadable?: boolean
}

type ApiRepositoryPolicy = {
  mode: 'observing' | 'learned'
  minimum_samples: number
  total_decisions: number
  approvals: number
  rejections: number
  approval_rate: number | null
  actions: Array<{
    action: string
    samples: number
    approvals: number
    rejections: number
    approval_rate: number
    guidance: 'observing' | 'caution' | 'mixed' | 'aligned'
  }>
  learned_rules: string[]
  updated_at: string | null
}

type ApiFixRun = {
  id: string
  investigation_id: string
  repo_name: string
  issue_number: number
  status: FixRun['status']
  base_sha: string | null
  summary: string | null
  patch_diff: string | null
  commands: string[][]
  receipts: Array<{
    command: string[]
    exit_code: number
    duration_ms: number
    stdout: string
    stderr: string
    containerized: boolean
    network_disabled: boolean
    image: string
    image_digest: string
  }>
  error: string | null
}

function toFixRun(run: ApiFixRun): FixRun {
  return {
    id: run.id,
    investigationId: run.investigation_id,
    repository: run.repo_name,
    issueNumber: run.issue_number,
    status: run.status,
    baseSha: run.base_sha ?? undefined,
    summary: run.summary ?? undefined,
    patch: run.patch_diff ?? undefined,
    commands: run.commands,
    receipts: run.receipts.map((receipt) => ({
      command: receipt.command,
      exitCode: receipt.exit_code,
      durationMs: receipt.duration_ms,
      stdout: receipt.stdout,
      stderr: receipt.stderr,
      containerized: receipt.containerized,
      networkDisabled: receipt.network_disabled,
      image: receipt.image,
      imageDigest: receipt.image_digest,
    })),
    error: run.error ?? undefined,
  }
}

function toRepositoryPolicy(policy: ApiRepositoryPolicy): RepositoryPolicy {
  return {
    mode: policy.mode,
    minimumSamples: policy.minimum_samples,
    totalDecisions: policy.total_decisions,
    approvals: policy.approvals,
    rejections: policy.rejections,
    approvalRate: policy.approval_rate ?? undefined,
    actions: policy.actions.map((item) => ({
      action: item.action,
      samples: item.samples,
      approvals: item.approvals,
      rejections: item.rejections,
      approvalRate: item.approval_rate,
      guidance: item.guidance,
    })),
    learnedRules: policy.learned_rules,
    updatedAt: policy.updated_at ?? undefined,
  }
}

/**
 * The backend's node names, in graph order, mapped to the UI's state machine.
 *
 * The triage graph has eight nodes; the UI's AgentRunState has ten values. The
 * mapping is deliberate rather than positional so that adding a node to the
 * graph cannot silently shift every subsequent step's rendered state.
 */
const NODE_STATE: Record<string, AgentRunState> = {
  issue_fetcher: 'reading',
  code_investigator: 'retrieving',
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
  // The API's "pr" is the UI's "pull_request". File evidence stays openable;
  // non-openable rule provenance is rendered as a decision.
  if (type === 'issue') return 'issue'
  if (type === 'pr') return 'pull_request'
  if (type === 'file') return 'file'
  return 'decision'
}

function humanizeRef(ref: string): string {
  const labels: Record<string, string> = {
    auto_apply_threshold: 'Approval threshold',
    classification: 'Model classification',
    demo_mode: 'Dry run',
    llm_confirmation: 'Model verification',
    no_action: 'Stay silent',
    no_similar_resolved: 'No recorded fix',
    insufficient_code_evidence: 'Insufficient code evidence',
    repository_policy: 'Repository policy',
    root_cause_hypothesis: 'Root-cause hypothesis',
  }
  return labels[ref] ?? ref.replaceAll('_', ' ')
}

function toEvidence(repoName: string, item: ApiEvidence, stepName?: string): EvidenceSource {
  const isIssue = item.type === 'issue'
  const isPull = item.type === 'pr'
  const isFile = item.type === 'file'
  const fileMatch = isFile ? item.ref.match(/^(.*?)(?::(\d+))?$/) : null
  const filePath = fileMatch?.[1]
  const fileLine = fileMatch?.[2]
  const encodedFilePath = filePath
    ?.split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const isImpactPoint = stepName === 'impact_scorer' && item.type === 'rule' && item.score != null
  return {
    id: isIssue
      ? `#${item.ref}`
      : isPull
        ? `PR #${item.ref}`
        : isFile
          ? item.ref
        : isImpactPoint
          ? `${humanizeRef(item.ref)} +${Math.round(item.score!)} points`
          : humanizeRef(item.ref),
    type: evidenceType(item.type),
    title: item.snippet || item.ref,
    url:
      isIssue || isPull
        ? `https://github.com/${repoName}/${isPull ? 'pull' : 'issues'}/${item.ref}`
        : isFile && encodedFilePath
          ? `https://github.com/${repoName}/blob/HEAD/${encodedFilePath}${fileLine ? `#L${fileLine}` : ''}`
          : undefined,
    // Similarity and confidence values are true 0-1 ratios. Impact evidence is
    // an additive point contribution (for example base=5), so passing it to a
    // percent formatter would falsely render 500%.
    score: isImpactPoint ? undefined : (item.score ?? undefined),
    reason: item.snippet || `${item.type} evidence`,
  }
}

function summaryCount(summary: string, key: string): number | undefined {
  const match = summary.match(new RegExp(`${key}=(\\d+)`))
  return match ? Number(match[1]) : undefined
}

function stepDetail(step: ApiStep): string {
  if (step.status === 'error') return step.output_summary || 'This investigation step failed.'

  if (step.name === 'issue_fetcher') {
    const issue = step.evidence.find((item) => item.type === 'issue')
    return issue ? `Fetched issue #${issue.ref} from GitHub.` : 'Fetched the issue from GitHub.'
  }

  if (step.name === 'duplicate_detector') {
    const count = step.evidence.filter((item) => item.type === 'issue').length
    return count === 0
      ? 'No duplicate or related issue passed the similarity threshold.'
      : `Found ${count} related ${count === 1 ? 'issue' : 'issues'} in repository history.`
  }

  if (step.name === 'code_investigator') {
    const files = step.evidence.filter((item) => item.type === 'file')
    return files.length === 0
      ? 'No indexed code location passed the relevance threshold; no root cause was claimed.'
      : `Found ${files.length} candidate code ${files.length === 1 ? 'location' : 'locations'}; similarity does not prove root cause.`
  }

  if (step.name === 'resolver') {
    if (step.evidence.some((item) => item.ref === 'no_similar_resolved')) {
      return 'No similar closed issue with a recorded fix was found.'
    }
    if (step.evidence.some((item) => /no recorded fix/i.test(item.snippet))) {
      return 'A related issue was found, but it has no recorded fix.'
    }
    const source = step.evidence.find((item) => item.type === 'issue')
    return source
      ? `Found a grounded fix in resolved issue #${source.ref}.`
      : 'No grounded project-specific fix was found.'
  }

  if (step.name === 'security_scanner') {
    const count = summaryCount(step.output_summary, 'security_findings')
    if (count === 0 || step.evidence.length === 0) return 'No security concern was confirmed.'
    if (count != null) return `Confirmed ${count} security ${count === 1 ? 'concern' : 'concerns'} for private review.`
    return 'Found a security-sensitive signal for private review.'
  }

  if (step.name === 'impact_scorer') {
    const score = summaryCount(step.output_summary, 'impact_score')
    return score == null ? 'Calculated the issue impact score.' : `Impact score: ${score}/100.`
  }

  if (step.name === 'labeler') {
    const count = summaryCount(step.output_summary, 'labels')
    const confidence = step.output_summary.match(/labels_confidence=([0-9.]+)/)?.[1]
    const suggested = step.output_summary.includes('labels_suggested=True')
    const labelText = count == null ? 'a label' : `${count} ${count === 1 ? 'label' : 'labels'}`
    const confidenceText = confidence == null ? '' : ` at ${Math.round(Number(confidence) * 100)}% confidence`
    return suggested
      ? `Suggested ${labelText}${confidenceText}; maintainer approval is required.`
      : `Classified ${labelText}${confidenceText}.`
  }

  if (step.name === 'decider') {
    const action = step.evidence.find((item) => item.type === 'rule' && item.ref !== 'demo_mode')
    const actionName = action ? humanizeRef(action.ref) : humanizeRef(step.output_summary)
    const confidence = action?.score == null ? '' : ` (${Math.round(action.score * 100)}% policy confidence)`
    return `Recommended: ${actionName.toLowerCase()}${confidence}.`
  }

  return step.output_summary
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
      detail: stepDetail(step),
      sources: step.evidence.map((item) => toEvidence(repoName, item, step.name)),
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

  const codeCandidate = run.steps
    .filter((step) => step.name === 'code_investigator')
    .flatMap((step) => step.evidence)
    .find((item) => item.type === 'file')
  if (codeCandidate) {
    const score = codeCandidate.score == null ? '' : ` at ${Math.round(codeCandidate.score * 100)}% similarity`
    factors.push(`Candidate code: ${codeCandidate.ref}${score}`)
  }

  const hypothesis = run.steps
    .filter((step) => step.name === 'code_investigator')
    .flatMap((step) => step.evidence)
    .find((item) => item.ref === 'root_cause_hypothesis')
  if (hypothesis) {
    const confidence = hypothesis.score == null ? '' : ` (${Math.round(hypothesis.score * 100)}%)`
    factors.push(`Code hypothesis${confidence}: ${hypothesis.snippet}`)
  }

  if (run.impact_score != null) {
    factors.push(`Impact scored ${Math.round(run.impact_score)}/100`)
  }

  return factors.slice(0, 4)
}

function toInsight(run: ApiInvestigation): Insight {
  // Only openable issue/PR/file evidence reaches the chips: "rule" items are the impact
  // scorer's and labeler's internal arithmetic (base=5, auto_apply_threshold),
  // which is provenance for the trace, not something a maintainer can open.
  // Deduplicated by id because several nodes cite the same issue.
  const seen = new Set<string>()
  const evidence: EvidenceSource[] = []
  for (const step of run.steps) {
    for (const item of step.evidence) {
      if (item.type !== 'issue' && item.type !== 'pr' && item.type !== 'file') continue
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

function toApproval(action: ApiProposedAction, insight: Insight): ApprovalAction {
  const changes: string[] = []
  if (action.comment) changes.push(`Comment:\n${action.comment}`)
  if (action.labels.length > 0) changes.push(`Labels: ${action.labels.join(', ')}`)
  return {
    id: action.id,
    kind: 'github_update',
    title: `Review ${action.action.replaceAll('_', ' ')} proposal`,
    detail: changes.join('\n\n'),
    reason: insight.summary,
    evidence: insight.evidence,
    status: action.status,
    result: action.result ?? undefined,
    error: action.error ?? undefined,
    live: true,
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
      let detail = `Backend returned ${response.status}.`
      try {
        const body = (await response.json()) as { detail?: string }
        if (body.detail) detail = body.detail
      } catch {
        // Preserve the status fallback for empty or non-JSON error bodies.
      }
      throw new GitHubError(detail, response.status, true)
    }
    return (await response.json()) as T
  }

  private async prepareRepositoryIndex(repoName: string): Promise<void> {
    const [owner, repo] = repoName.split('/', 2)
    if (!owner || !repo) return
    try {
      const job = await this.request<{ job_id?: string; status?: string }>(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/index`,
        { method: 'POST' },
      )
      if (job.status === 'ready' || job.status === 'done') return
      if (!job.job_id || !['queued', 'running'].includes(job.status ?? '')) return

      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 750))
        const current = await this.request<{ status: string }>(
          `/api/index-jobs/${encodeURIComponent(job.job_id)}`,
        )
        if (current.status === 'done' || current.status === 'ready') return
        if (current.status === 'error') return
      }
    } catch {
      // Indexing is an evidence enhancement, not a prerequisite for triage.
      // The code node will report insufficient evidence rather than failing
      // the entire investigation when indexing is unavailable.
    }
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
    await this.prepareRepositoryIndex(repoName)
    const { investigation_id: id } = await this.request<{ investigation_id: string }>(
      '/api/investigations',
      { method: 'POST', body: JSON.stringify({ repo_name: repoName, kind, number }) },
    )

    const deadline = Date.now() + 45_000
    let delay = 400
    for (;;) {
      let run: ApiInvestigation
      try {
        run = await this.request<ApiInvestigation>(`/api/investigations/${id}`)
      } catch (error) {
        // FastAPI schedules the graph after returning the id. On a fast local
        // connection the first detail request can win that race and see 404
        // before the background task inserts its investigation row.
        if (!(error instanceof GitHubError) || error.status !== 404) throw error
        if (Date.now() > deadline) {
          throw new GitHubError('The backend investigation did not appear in time.', 504, true)
        }
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay = Math.min(delay * 1.4, 2_000)
        continue
      }
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

    const insight = toInsight(run)
    return {
      runId: run.investigation_id,
      issue,
      insight,
      events: toAgentEvents(run),
      approval: run.proposed_action ? toApproval(run.proposed_action, insight) : undefined,
    }
  }

  async decideAction(action: ApprovalAction, approved: boolean): Promise<ApprovalAction> {
    const decided = await this.request<ApiProposedAction>(
      `/api/actions/${encodeURIComponent(action.id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({
          approved,
          decided_by: 'RepoGuardian Lens maintainer',
        }),
      },
    )
    return toApproval(decided, {
      title: action.title,
      summary: action.reason,
      confidence: 0,
      decision: 'silent',
      evidence: action.evidence,
      factors: [],
      suggestedAction: action.detail,
    })
  }

  async startFixRun(investigationId: string): Promise<FixRun> {
    let run = await this.request<ApiFixRun>('/api/fix-runs', {
      method: 'POST',
      body: JSON.stringify({ investigation_id: investigationId }),
    })
    const deadline = Date.now() + 5 * 60_000
    const terminal = new Set(['proposed', 'failed', 'approved', 'rejected', 'published'])
    while (!terminal.has(run.status)) {
      if (Date.now() > deadline) {
        throw new GitHubError('Fix Lab did not finish within five minutes.', 504, true)
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      run = await this.request<ApiFixRun>(`/api/fix-runs/${encodeURIComponent(run.id)}`)
    }
    return toFixRun(run)
  }

  async decideFixRun(runId: string, approved: boolean): Promise<FixRun> {
    const run = await this.request<ApiFixRun>(
      `/api/fix-runs/${encodeURIComponent(runId)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({
          approved,
          decided_by: 'RepoGuardian Lens maintainer',
        }),
      },
    )
    return toFixRun(run)
  }

  async getRepositoryHealth(input: RepositoryInput): Promise<HealthReport> {
    const health = await this.request<ApiHealth>(
      `/api/repos/${input.owner}/${input.repo}/health`,
    )
    if (health.unreadable) {
      throw new GitHubError(
        `The backend could not read ${input.owner}/${input.repo} from GitHub. Check its GITHUB_TOKEN and network access.`,
        502,
        true,
      )
    }
    const { breakdown } = health
    return {
      score: health.measured === false ? 0 : Math.round(health.score),
      interpretation:
        health.measured === false
          ? 'The backend reached GitHub but found no issues to measure.'
          : `Backend health scoring across ${health.issue_count ?? 'the current'} issues: responsiveness ${Math.round(breakdown.responsiveness)}, staleness ${Math.round(breakdown.staleness)}, duplication ${Math.round(breakdown.duplication)}, security ${Math.round(breakdown.security)}.`,
      metrics: [
        { label: 'Responsiveness', value: String(Math.round(breakdown.responsiveness)), change: 'of 100', direction: 'up', concern: breakdown.responsiveness < 50 },
        { label: 'Staleness', value: String(Math.round(breakdown.staleness)), change: 'of 100', direction: 'up', concern: breakdown.staleness < 50 },
        { label: 'Duplication', value: String(Math.round(breakdown.duplication)), change: 'of 100', direction: 'up', concern: breakdown.duplication < 50 },
        { label: 'Security', value: String(Math.round(breakdown.security)), change: 'of 100', direction: 'up', concern: breakdown.security < 50 },
      ],
      evidence: [],
    }
  }

  // --- Remaining surfaces not exposed by the backend use real GitHub data ---
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
    const [memory, policy] = await Promise.all([
      this.fallback.getRepositoryMemory(input),
      this.request<ApiRepositoryPolicy>(
        `/api/policy?repo_name=${encodeURIComponent(`${input.owner}/${input.repo}`)}`,
      ),
    ])
    return { ...memory, policy: toRepositoryPolicy(policy) }
  }

  async getActivity(input: RepositoryInput): Promise<ActivitySummary> {
    const repoName = `${input.owner}/${input.repo}`
    const query = encodeURIComponent(repoName)
    const [escalations, investigations] = await Promise.all([
      this.request<ApiEscalation[]>(`/api/escalations?repo_name=${query}`),
      this.request<ApiInvestigationSummary[]>(`/api/investigations?repo_name=${query}`),
    ])

    const openEscalations = escalations
      .filter((item) => item.number > 0 && item.title)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
    const visible = openEscalations.slice(0, 3)
    const details = await Promise.all(
      visible.map(async (item) => {
        try {
          return await this.request<ApiInvestigation>(
            `/api/investigations/${item.investigation_id}`,
          )
        } catch {
          // The escalation remains real and useful even if its detail was
          // removed or is temporarily unavailable. Do not invent confidence.
          return undefined
        }
      }),
    )

    const openIds = new Set(openEscalations.map((item) => item.investigation_id))
    const completedWithoutOpenEscalation = investigations.filter(
      (item) =>
        item.kind === 'issue' &&
        item.status === 'done' &&
        item.decision !== 'error' &&
        !openIds.has(item.investigation_id),
    ).length

    return {
      source: 'backend',
      automatedCount: completedWithoutOpenEscalation,
      attentionCount: openEscalations.length,
      items: visible.map((item, index) => ({
        issueNumber: item.number,
        title: item.title,
        confidence: details[index]?.confidence ?? undefined,
        severity: item.severity === 'critical' ? 'critical' : 'warning',
      })),
    }
  }

  async answerQuestion(input: QuestionInput): Promise<GroundedAnswer> {
    return this.fallback.answerQuestion(input)
  }
}
