import { describe, expect, it } from 'vitest'

import { MockAgentEngine } from './MockAgentEngine'
import { searchRepositoryMemory } from './retrieval'
import { DEMO_ISSUES } from './seededRepository'

const repository = { owner: 'acme', repo: 'payments-api' }
const engine = new MockAgentEngine()

describe('MockAgentEngine', () => {
  it('produces the locked #482 escalation with evidence and auditable state transitions', async () => {
    const result = await engine.investigateIssue({ ...repository, issueNumber: 482 })
    expect(result.insight.decision).toBe('escalate')
    expect(result.insight.confidence).toBe(0.94)
    expect(result.insight.evidence.map((source) => source.id)).toEqual(['#331', '#402', 'PR #188'])
    expect(result.events.map((event) => event.state)).toEqual([
      'queued',
      'reading',
      'retrieving',
      'comparing',
      'checking_precedent',
      'assessing_impact',
      'deciding',
      'completed',
    ])
  })

  it('preserves the silent, follow-up, duplicate, and uncertainty decisions', async () => {
    await expect(engine.getIssueInsight({ ...repository, issueNumber: 476 })).resolves.toMatchObject({
      decision: 'silent',
      confidence: 0.88,
    })
    await expect(engine.getIssueInsight({ ...repository, issueNumber: 491 })).resolves.toMatchObject({
      decision: 'follow_up',
      confidence: 0.81,
    })
    await expect(engine.getIssueInsight({ ...repository, issueNumber: 495 })).resolves.toMatchObject({
      decision: 'duplicate',
      confidence: 0.94,
    })
    await expect(engine.getIssueInsight({ ...repository, issueNumber: 498 })).resolves.toMatchObject({
      decision: 'silent',
      confidence: 0.42,
      insufficientEvidence: true,
    })
  })

  it('returns the canonical duplicate and repository-history PR risk', async () => {
    const duplicates = await engine.findDuplicates({ ...repository, issueNumber: 495 })
    expect(duplicates[0]).toMatchObject({ similarity: 0.94, canonical: true })
    expect(duplicates[0].issue.id).toBe('#382')

    const review = await engine.reviewPullRequest({ ...repository, pullNumber: 201 })
    expect(review.risk).toBe('high')
    expect(review.evidence).toHaveLength(3)
    expect(review.path).toEqual(['auth.ts', 'token.ts', 'refresh.ts'])
  })

  it('grounds Ask answers and retrieval results in repository evidence', async () => {
    const answer = await engine.answerQuestion({ ...repository, question: 'Why did you escalate #482?' })
    expect(answer.evidence).toHaveLength(3)
    expect(answer.confidence).toBe(0.94)

    const results = searchRepositoryMemory({
      query: 'OAuth refresh token expiration',
      repository: 'acme/payments-api',
      issue: DEMO_ISSUES[482],
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].whyMatched).not.toBe('')
  })
})
