import type {
  DuplicateResult,
  GroundedAnswer,
  Investigation,
  PRReview,
} from '@/lib/types'

import type { AgentEngine, IssueInput, PullRequestInput, QuestionInput } from './AgentEngine'
import { decideIssue } from './decisions'
import { buildAgentEvents } from './events'
import { fixedEvidence, searchRepositoryMemory } from './retrieval'
import {
  DEMO_ACTIVITY,
  DEMO_HEALTH,
  DEMO_ISSUES,
  DEMO_MEMORY,
  DEMO_PULL_REQUESTS,
  DEMO_REPOSITORY,
} from './seededRepository'

function issueFor(number: number) {
  return (
    DEMO_ISSUES[number] ?? {
      number,
      title: `Issue #${number} requires live repository data`,
      body: 'Demo mode has no seeded content for this issue.',
      subsystem: 'unknown',
      labels: ['live-context'],
      symptoms: ['unknown'],
    }
  )
}

export class MockAgentEngine implements AgentEngine {
  async getRepositoryContext() {
    return DEMO_REPOSITORY
  }

  async getIssueInsight(input: IssueInput) {
    return decideIssue(issueFor(input.issueNumber)).insight
  }

  async investigateIssue(input: IssueInput): Promise<Investigation> {
    const issue = issueFor(input.issueNumber)
    const { insight, approval } = decideIssue(issue)
    const partial = {
      runId: `demo-${issue.number}`,
      issue,
      insight,
      approval,
    }
    return { ...partial, events: buildAgentEvents(partial) }
  }

  async reviewPullRequest(input: PullRequestInput): Promise<PRReview> {
    const pullRequest =
      DEMO_PULL_REQUESTS[input.pullNumber] ?? {
        number: input.pullNumber,
        title: `Pull request #${input.pullNumber}`,
        files: ['Live file list unavailable in demo mode'],
        subsystem: 'unknown',
      }
    const seeded = input.pullNumber === 201
    return {
      pullRequest,
      risk: seeded ? 'high' : 'moderate',
      confidence: seeded ? 0.86 : 0.42,
      summary: seeded
        ? 'This change touches a subsystem with three historical production incidents.'
        : 'Live repository history is unavailable; the extension will not claim a high-risk result.',
      path: seeded ? ['auth.ts', 'token.ts', 'refresh.ts'] : [],
      evidence: seeded ? fixedEvidence('issue331', 'issue402', 'pr188') : [],
    }
  }

  async findDuplicates(input: IssueInput): Promise<DuplicateResult[]> {
    if (input.issueNumber === 495) {
      return [
        {
          issue: fixedEvidence('issue382')[0],
          similarity: 0.94,
          sameComponent: 'settings/configuration',
          sameSymptom: 'application freeze',
          sameEnvironment: 'Windows 11',
          canonical: true,
        },
        {
          issue: fixedEvidence('issue401')[0],
          similarity: 0.82,
          sameComponent: 'settings/configuration',
          sameSymptom: 'unresponsive settings screen',
          canonical: false,
        },
      ]
    }

    return searchRepositoryMemory({
      query: issueFor(input.issueNumber).title,
      repository: `${input.owner}/${input.repo}`,
      issue: issueFor(input.issueNumber),
      limit: 3,
    }).map((evidence, index) => ({
      issue: evidence,
      similarity: evidence.score ?? 0,
      sameComponent: evidence.subsystem ?? 'unknown',
      sameSymptom: evidence.whyMatched,
      canonical: index === 0,
    }))
  }

  async getRepositoryHealth() {
    return DEMO_HEALTH
  }

  async getRepositoryMemory() {
    return DEMO_MEMORY
  }

  async getActivity() {
    return DEMO_ACTIVITY
  }

  async answerQuestion(input: QuestionInput): Promise<GroundedAnswer> {
    const question = input.question.toLowerCase()

    if (question.includes('care') || question.includes('work on')) {
      return {
        answer:
          'Focus first on #482 because it matches two authentication incidents and a maintainer escalation precedent. Then collect missing reproduction data for #491 and review the migration lock path for #477.',
        confidence: 0.9,
        evidence: fixedEvidence('issue331', 'issue402', 'pr188', 'issue271', 'pr205'),
        suggestedAction: 'Open the #482 investigation, then approve the focused follow-up for #491.',
      }
    }

    if (question.includes('482') || question.includes('escalat') || question.includes('important')) {
      const { insight } = decideIssue(DEMO_ISSUES[482])
      return {
        answer:
          'Issue #482 resembles two historical authentication incidents and matches a previous maintainer decision to escalate token lifecycle failures.',
        confidence: insight.confidence,
        evidence: insight.evidence,
        suggestedAction: insight.suggestedAction,
      }
    }

    if (question.includes('pr') || question.includes('risk')) {
      return {
        answer:
          'PR #201 changes the token-rotation path, a subsystem associated with three historical production incidents.',
        confidence: 0.86,
        evidence: fixedEvidence('issue331', 'issue402', 'pr188'),
        suggestedAction: 'Review auth.ts, token.ts, and refresh.ts together before approval.',
      }
    }

    if (question.includes('changed') || question.includes('health')) {
      return {
        answer:
          'Maintainer response time increased 31% while contributor activity declined 11%; duplicate rate improved by 4%.',
        confidence: 0.84,
        evidence: DEMO_HEALTH.evidence,
        suggestedAction: 'Review the authentication backlog and recent triage workflow change.',
      }
    }

    const evidence = searchRepositoryMemory({
      query: input.question,
      repository: `${input.owner}/${input.repo}`,
      limit: 4,
    })
    return {
      answer:
        evidence.length > 0
          ? `Project memory contains ${evidence.length} relevant records. The strongest match is ${evidence[0].id}: ${evidence[0].title}.`
          : 'Insufficient evidence: demo repository memory does not contain a reliable answer to this question.',
      confidence: evidence.length > 0 ? Math.min(0.82, evidence[0].score ?? 0.42) : 0.32,
      evidence,
      suggestedAction:
        evidence.length > 0 ? 'Open the strongest evidence item and verify the historical context.' : 'Use live mode with a configured backend or ask a repository-specific question.',
    }
  }
}
