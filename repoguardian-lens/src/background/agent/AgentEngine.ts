import type {
  ActivitySummary,
  ApprovalAction,
  DuplicateResult,
  GroundedAnswer,
  GitHubContext,
  HealthReport,
  Insight,
  Investigation,
  FixRun,
  PRReview,
  RepositoryContext,
  RepositoryMemory,
} from '@/lib/types'

export type RepositoryInput = { owner: string; repo: string }
export type IssueInput = RepositoryInput & { issueNumber: number }
export type PullRequestInput = RepositoryInput & { pullNumber: number }
export type QuestionInput = RepositoryInput & {
  question: string
  /** Current GitHub page, used to ground phrases such as "this issue". */
  context?: GitHubContext
}

export interface AgentEngine {
  getRepositoryContext(input: RepositoryInput): Promise<RepositoryContext>
  getIssueInsight(input: IssueInput): Promise<Insight>
  investigateIssue(input: IssueInput): Promise<Investigation>
  reviewPullRequest(input: PullRequestInput): Promise<PRReview>
  findDuplicates(input: IssueInput): Promise<DuplicateResult[]>
  getRepositoryHealth(input: RepositoryInput): Promise<HealthReport>
  getRepositoryMemory(input: RepositoryInput): Promise<RepositoryMemory>
  getActivity(input: RepositoryInput): Promise<ActivitySummary>
  answerQuestion(input: QuestionInput): Promise<GroundedAnswer>
  /** Persist and, when approved, execute an exact backend action proposal. */
  decideAction?(action: ApprovalAction, approved: boolean): Promise<ApprovalAction>
  /** Generate and container-verify a candidate patch. Never publishes it. */
  startFixRun?(investigationId: string): Promise<FixRun>
  /** Review a verified patch. Approval still does not publish a PR. */
  decideFixRun?(runId: string, approved: boolean): Promise<FixRun>
}
