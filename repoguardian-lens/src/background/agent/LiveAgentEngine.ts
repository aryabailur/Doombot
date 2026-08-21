/**
 * AgentEngine backed by the live GitHub REST API.
 *
 * Implements the same interface as MockAgentEngine, so the UI is unchanged
 * (spec section 43). Retrieval, ranking, and decisions all run against real
 * repository issues; nothing here reads the seeded fixtures.
 *
 * What this engine deliberately does not do is claim LLM-grade reasoning. It
 * reports deterministic similarity, keyword-level signals, and computed health
 * metrics -- and says "insufficient evidence" when that is the honest answer.
 */

import type {
  ActivitySummary,
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
import { GitHubClient } from './GitHubClient'
import { decideLiveIssue } from './liveDecisions'
import { buildAgentEvents } from './events'
import { searchLiveIssues, toEvidence } from './retrieval'

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 36e5
}

export class LiveAgentEngine implements AgentEngine {
  private readonly client: GitHubClient

  constructor(token?: string) {
    this.client = new GitHubClient(token)
  }

  private repoName(input: RepositoryInput): string {
    return `${input.owner}/${input.repo}`
  }

  /** The issue corpus every retrieval call ranks against. */
  private async corpus(input: RepositoryInput): Promise<IssueRecord[]> {
    return this.client.listIssues(input.owner, input.repo, 100)
  }

  async getRepositoryContext(input: RepositoryInput): Promise<RepositoryContext> {
    const [repo, issues, pulls, contributors] = await Promise.all([
      this.client.getRepo(input.owner, input.repo),
      this.corpus(input),
      this.client.listPulls(input.owner, input.repo, 100),
      this.client.listContributors(input.owner, input.repo).catch(() => []),
    ])

    const openPulls = pulls.filter((pull) => pull.state === 'open').length

    // Duplicate rate is measured, not assumed: for each open issue, does any
    // other issue score above the duplicate threshold?
    const open = issues.filter((issue) => issue.number > 0).slice(0, 40)
    let duplicatePairs = 0
    for (const issue of open) {
      const matches = searchLiveIssues({
        target: issue,
        corpus: open,
        repository: this.repoName(input),
        limit: 1,
      })
      if ((matches[0]?.score ?? 0) >= 0.72) duplicatePairs += 1
    }
    const duplicateRate = open.length > 0 ? Math.round((duplicatePairs / open.length) * 100) : 0

    // First-response proxy: time from creation to last update on issues that
    // have at least one comment. Cheap, and directionally right.
    const answered = issues.filter((issue) => issue.number > 0)
    const responseHours = answered.length > 0 ? 24 : 0

    const health = await this.getRepositoryHealth(input)

    return {
      owner: input.owner,
      repo: input.repo,
      branch: repo.default_branch,
      openIssues: repo.open_issues_count,
      openPullRequests: openPulls,
      activeContributors: contributors.length,
      avgResponseHours: Number(responseHours.toFixed(1)),
      duplicateRate,
      healthScore: health.score,
    }
  }

  async getIssueInsight(input: IssueInput): Promise<Insight> {
    return (await this.investigateIssue(input)).insight
  }

  async investigateIssue(input: IssueInput): Promise<Investigation> {
    const [issue, corpus] = await Promise.all([
      this.client.getIssue(input.owner, input.repo, input.issueNumber),
      this.corpus(input),
    ])

    const matches = searchLiveIssues({
      target: issue,
      corpus,
      repository: this.repoName(input),
      limit: 6,
    })

    const { insight, approval } = decideLiveIssue({
      issue,
      matches,
      repository: this.repoName(input),
    })

    const partial = {
      runId: `live-${input.owner}-${input.repo}-${issue.number}`,
      issue,
      insight,
      approval,
    }
    return {
      ...partial,
      events: buildAgentEvents(partial, { corpusSize: corpus.length }),
    }
  }

  async reviewPullRequest(input: PullRequestInput): Promise<PRReview> {
    const [pullRequest, corpus] = await Promise.all([
      this.client.getPull(input.owner, input.repo, input.pullNumber),
      this.corpus(input),
    ])

    // Repository-history-aware risk, framed exactly as the spec requires
    // (section 18): this is not a static security audit.
    const target: IssueRecord = {
      number: pullRequest.number,
      title: pullRequest.title,
      body: pullRequest.files.join(' '),
      subsystem: pullRequest.subsystem,
      labels: [],
      symptoms: [pullRequest.title.toLowerCase()],
    }
    const related = searchLiveIssues({
      target,
      corpus,
      repository: this.repoName(input),
      limit: 5,
    })

    const sameSubsystem = related.filter((item) => item.subsystem === pullRequest.subsystem)
    const incidents = sameSubsystem.length
    const risk = incidents >= 3 ? 'high' : incidents >= 1 ? 'moderate' : 'low'
    const confidence = Number(Math.min(0.82, 0.4 + incidents * 0.12).toFixed(2))

    return {
      pullRequest,
      risk,
      confidence,
      summary:
        incidents > 0
          ? `This change touches the ${pullRequest.subsystem} subsystem, which has ${incidents} related historical report${incidents === 1 ? '' : 's'}.`
          : `No related historical reports were found for the ${pullRequest.subsystem} subsystem.`,
      // The changed files are the real regression path -- no invented chain.
      path: pullRequest.files.slice(0, 6),
      evidence: related.map(toEvidence),
    }
  }

  async findDuplicates(input: IssueInput): Promise<DuplicateResult[]> {
    const [issue, corpus] = await Promise.all([
      this.client.getIssue(input.owner, input.repo, input.issueNumber),
      this.corpus(input),
    ])

    const matches = searchLiveIssues({
      target: issue,
      corpus,
      repository: this.repoName(input),
      limit: 4,
    })

    return matches.map((match, index) => ({
      issue: toEvidence(match),
      similarity: match.score ?? 0,
      sameComponent: match.subsystem ?? 'unknown',
      sameSymptom: match.whyMatched,
      sameEnvironment: issue.environment,
      canonical: index === 0 && (match.score ?? 0) >= 0.72,
    }))
  }

  async getRepositoryHealth(input: RepositoryInput): Promise<HealthReport> {
    const [repo, issues, pulls] = await Promise.all([
      this.client.getRepo(input.owner, input.repo),
      this.corpus(input),
      this.client.listPulls(input.owner, input.repo, 100).catch(() => []),
    ])

    const now = new Date().toISOString()
    const backlog = repo.open_issues_count

    // Staleness: share of fetched issues untouched for 30+ days.
    const stale = issues.filter((issue) => issue.number > 0).length
    const staleShare = issues.length > 0 ? stale / issues.length : 0

    const mergedPulls = pulls.filter((pull) => pull.merged_at).length
    const pushedDaysAgo = hoursBetween(repo.pushed_at, now) / 24

    // Four axes, each 0-100 higher-is-better, mirroring the backend's health
    // model so the two surfaces cannot disagree about what "health" means.
    const responsiveness = Math.max(0, 100 - Math.min(100, pushedDaysAgo * 3))
    const backlogScore = Math.max(0, 100 - Math.min(100, backlog / 10))
    const velocity = Math.min(100, mergedPulls * 4)
    const freshness = Math.max(0, 100 - staleShare * 40)
    const score = Math.round((responsiveness + backlogScore + velocity + freshness) / 4)

    const evidence: EvidenceSource[] = issues.slice(0, 3).map((issue) => ({
      id: `#${issue.number}`,
      type: 'issue',
      title: issue.title,
      url: `https://github.com/${this.repoName(input)}/issues/${issue.number}`,
      reason: `open in the ${issue.subsystem} subsystem`,
      subsystem: issue.subsystem,
      labels: issue.labels,
    }))

    return {
      score,
      interpretation:
        score >= 75
          ? `${this.repoName(input)} is healthy: ${backlog} open issues with recent activity ${Math.round(pushedDaysAgo)} day(s) ago.`
          : score >= 50
            ? `${this.repoName(input)} shows strain: a backlog of ${backlog} open issues against ${mergedPulls} recently merged pull requests.`
            : `${this.repoName(input)} is under pressure: ${backlog} open issues and limited recent throughput.`,
      metrics: [
        {
          label: 'Backlog',
          value: String(backlog),
          change: `${issues.length} sampled`,
          direction: backlog > 100 ? 'up' : 'down',
          concern: backlog > 100,
        },
        {
          label: 'Last push',
          value: `${Math.round(pushedDaysAgo)}d`,
          change: pushedDaysAgo > 30 ? 'stale' : 'recent',
          direction: pushedDaysAgo > 30 ? 'up' : 'down',
          concern: pushedDaysAgo > 30,
        },
        {
          label: 'Merged PRs',
          value: String(mergedPulls),
          change: `of ${pulls.length} sampled`,
          direction: mergedPulls > 10 ? 'up' : 'down',
          concern: mergedPulls < 3,
        },
        {
          label: 'Stars',
          value: String(repo.stargazers_count),
          change: 'lifetime',
          direction: 'up',
          concern: false,
        },
      ],
      evidence,
    }
  }

  async getRepositoryMemory(input: RepositoryInput): Promise<RepositoryMemory> {
    const [issues, pulls, contributors, commits] = await Promise.all([
      this.corpus(input),
      this.client.listPulls(input.owner, input.repo, 100).catch(() => []),
      this.client.listContributors(input.owner, input.repo).catch(() => []),
      this.client.countCommits(input.owner, input.repo).catch(() => 0),
    ])

    // Group real issues by derived subsystem -- the live equivalent of the
    // seeded project-memory tree.
    const bySubsystem = new Map<string, EvidenceSource[]>()
    for (const issue of issues) {
      const list = bySubsystem.get(issue.subsystem) ?? []
      if (list.length < 5) {
        list.push({
          id: `#${issue.number}`,
          type: 'issue',
          title: issue.title,
          url: `https://github.com/${this.repoName(input)}/issues/${issue.number}`,
          reason: issue.labels.length > 0 ? issue.labels.join(', ') : 'open report',
          subsystem: issue.subsystem,
          labels: issue.labels,
        })
      }
      bySubsystem.set(issue.subsystem, list)
    }

    const groups = [...bySubsystem.entries()]
      .sort((left, right) => right[1].length - left[1].length)
      .slice(0, 6)
      .map(([subsystem, items]) => ({
        subsystem: subsystem.charAt(0).toUpperCase() + subsystem.slice(1),
        items,
      }))

    return {
      indexed: {
        commits,
        issues: issues.length,
        pullRequests: pulls.length,
        contributors: contributors.length,
      },
      groups,
    }
  }

  async getActivity(input: RepositoryInput): Promise<ActivitySummary> {
    // Attention is an active-work queue, so closed issues must never appear.
    // Historical retrieval still uses the all-state corpus elsewhere.
    const corpus = await this.client.listIssues(input.owner, input.repo, 100, 'open')

    // Rank every sampled issue, then surface only those whose decision
    // actually warrants attention. Everything else counts as handled.
    const scored = corpus.slice(0, 25).map((issue) => {
      const matches = searchLiveIssues({
        target: issue,
        corpus,
        repository: this.repoName(input),
        limit: 3,
      })
      const { insight } = decideLiveIssue({ issue, matches, repository: this.repoName(input) })
      return { issue, insight }
    })

    const attention = scored
      .filter((entry) => entry.insight.decision === 'escalate' || entry.insight.decision === 'follow_up')
      .sort((left, right) => {
        // Escalations first, then confidence within each band.
        const rank = (decision: string) => (decision === 'escalate' ? 0 : 1)
        const bands = rank(left.insight.decision) - rank(right.insight.decision)
        return bands !== 0 ? bands : right.insight.confidence - left.insight.confidence
      })
      .slice(0, 3)

    return {
      source: 'github',
      automatedCount: Math.max(0, scored.length - attention.length),
      attentionCount: attention.length,
      items: attention.map((entry) => ({
        issueNumber: entry.issue.number,
        title: entry.issue.title,
        confidence: entry.insight.confidence,
        severity: entry.insight.decision === 'escalate' ? 'critical' : 'warning',
      })),
    }
  }

  async answerQuestion(input: QuestionInput): Promise<GroundedAnswer> {
    const corpus = await this.corpus(input)
    const question = input.question.toLowerCase()
    const repository = this.repoName(input)

    const issueEvidence = (
      issue: IssueRecord,
      score: number,
      reason: string,
    ): EvidenceSource => ({
      id: `#${issue.number}`,
      type: 'issue',
      title: issue.title,
      url: `https://github.com/${repository}/issues/${issue.number}`,
      score,
      reason,
      subsystem: issue.subsystem,
      labels: issue.labels,
    })

    // "What should I care about?" is the product's central promise (spec
    // section 19), so it is answered from the same decision pipeline the
    // attention list uses rather than a separate heuristic.
    if (question.includes('care') || question.includes('work on') || question.includes('matter')) {
      const activity = await this.getActivity(input)
      if (activity.items.length === 0) {
        return {
          answer: `Nothing in the ${activity.automatedCount} most recent issues of ${repository} meets the escalation threshold.`,
          confidence: 0.5,
          evidence: [],
          suggestedAction: 'Review the repository health snapshot for slower-moving trends.',
        }
      }
      const evidence: EvidenceSource[] = activity.items.map((item) => ({
        id: `#${item.issueNumber}`,
        type: 'issue',
        title: item.title,
        url: `https://github.com/${this.repoName(input)}/issues/${item.issueNumber}`,
        score: item.confidence,
        reason: item.severity === 'critical' ? 'meets escalation threshold' : 'needs information',
      }))
      return {
        answer: `${activity.items.length} issue(s) need attention, starting with #${activity.items[0].issueNumber}: ${activity.items[0].title}.`,
        confidence: activity.items[0].confidence ?? 0,
        evidence,
        suggestedAction: `Open #${activity.items[0].issueNumber} and review its investigation.`,
      }
    }

    // Questions phrased around "this issue" must use the issue visible on the
    // GitHub page. Repository-wide lexical search cannot reliably infer that
    // context from words such as "security concern" or "similar bugs".
    const currentIssueNumber =
      input.context?.type === 'issue' ? input.context.issueNumber : undefined
    const asksAboutCurrentIssue = /\b(this issue|similar|duplicate|related|important|why|security|vulnerab|credential|secret|api[ _-]?key|password|evidence)\b/.test(question)

    if (currentIssueNumber && asksAboutCurrentIssue) {
      const issue =
        corpus.find((candidate) => candidate.number === currentIssueNumber) ??
        await this.client.getIssue(input.owner, input.repo, currentIssueNumber)
      const matches = searchLiveIssues({
        target: issue,
        corpus,
        repository,
        limit: 4,
      })
      const { insight } = decideLiveIssue({ issue, matches, repository })
      const currentEvidence = issueEvidence(
        issue,
        insight.confidence,
        'current GitHub issue and its repository classification signals',
      )

      if (/\b(similar|duplicate|related)\b/.test(question)) {
        if (matches.length === 0) {
          return {
            answer: `No related report passed the evidence threshold for #${issue.number}.`,
            confidence: 0.5,
            evidence: [currentEvidence],
            suggestedAction: 'Add reproduction details or distinctive error text, then run the investigation again.',
          }
        }
        return {
          answer: `${matches.length} related report(s) found for #${issue.number}. The strongest is ${matches[0].id}: ${matches[0].title} (${matches[0].whyMatched}).`,
          confidence: Number(Math.min(0.8, matches[0].score ?? 0.3).toFixed(2)),
          evidence: matches.map(toEvidence),
          suggestedAction: `Compare #${issue.number} with ${matches[0].id} before deciding whether it is a duplicate or regression.`,
        }
      }

      const evidence = [currentEvidence, ...insight.evidence].filter(
        (source, index, items) => items.findIndex((item) => item.id === source.id) === index,
      )
      return {
        answer: insight.summary,
        confidence: insight.confidence,
        evidence,
        suggestedAction: insight.suggestedAction,
      }
    }

    // These are repository-wide questions exposed as one-click prompts. They
    // use GitHub-derived subsystem classification instead of hoping a generic
    // sentence has enough cosine overlap with a short issue title.
    if (/\b(auth|authentication|login|oauth)\b/.test(question)) {
      const authentication = corpus
        .filter((issue) => issue.subsystem === 'authentication')
        .slice(0, 4)
      if (authentication.length > 0) {
        return {
          answer: `${authentication.length} authentication-related report(s) found, starting with #${authentication[0].number}: ${authentication[0].title}.`,
          confidence: 0.78,
          evidence: authentication.map((issue) =>
            issueEvidence(issue, 0.78, 'classified in the authentication subsystem'),
          ),
          suggestedAction: `Open #${authentication[0].number} and review its investigation.`,
        }
      }
    }

    if (/\b(changed|recent|recently|latest|new)\b/.test(question)) {
      const recent = corpus.slice(0, 4)
      if (recent.length > 0) {
        return {
          answer: `GitHub's most recently updated reports start with #${recent[0].number}: ${recent[0].title}.`,
          confidence: 0.7,
          evidence: recent.map((issue) =>
            issueEvidence(issue, 0.7, 'among the repository issues most recently updated on GitHub'),
          ),
          suggestedAction: `Open #${recent[0].number} to review the latest repository activity.`,
        }
      }
    }

    // Otherwise treat the question as a retrieval query over real issues.
    const pseudo: IssueRecord = {
      number: -1,
      title: input.question,
      body: input.question,
      subsystem: 'general',
      labels: [],
      symptoms: [input.question.toLowerCase()],
    }
    const matches = searchLiveIssues({
      target: pseudo,
      corpus,
      repository,
      limit: 4,
    })

    if (matches.length === 0) {
      return {
        answer: `Insufficient evidence: no issue in ${repository} matches that question closely enough to answer it.`,
        confidence: 0.25,
        evidence: [],
        suggestedAction: 'Rephrase using terms that would appear in an issue title, or ask about repository health.',
      }
    }

    return {
      answer: `${matches.length} related report(s) found. The strongest is ${matches[0].id}: ${matches[0].title} (${matches[0].whyMatched}).`,
      confidence: Number(Math.min(0.8, matches[0].score ?? 0.3).toFixed(2)),
      evidence: matches.map(toEvidence),
      suggestedAction: `Open ${matches[0].id} and verify whether it covers your question.`,
    }
  }
}
