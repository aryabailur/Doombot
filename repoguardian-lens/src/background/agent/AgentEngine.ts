import type {
  ActivitySummary,
  DuplicateResult,
  GroundedAnswer,
  HealthReport,
  Insight,
  Investigation,
  PRReview,
  RepositoryContext,
  RepositoryMemory,
} from '@/lib/types'

export type RepositoryInput = { owner: string; repo: string }
export type IssueInput = RepositoryInput & { issueNumber: number }
export type PullRequestInput = RepositoryInput & { pullNumber: number }
export type QuestionInput = RepositoryInput & { question: string }

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
}
