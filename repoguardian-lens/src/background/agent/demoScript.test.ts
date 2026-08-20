import { describe, expect, it } from 'vitest'
import { MockAgentEngine } from './MockAgentEngine'

const repo = { owner: 'acme', repo: 'payments-api' }
const engine = new MockAgentEngine()

/**
 * Locks every value the scripted demo (spec section 58) puts on screen.
 *
 * The seeded engine now shares its event builder with the live engine, so this
 * guards against a refactor there silently changing the presentation path.
 */
describe('scripted demo path is unchanged', () => {
  it('matches every locked value from the spec demo script', async () => {
    for (const [n, decision, confidence] of [
      [482, 'escalate', 0.94], [476, 'silent', 0.88], [491, 'follow_up', 0.81],
      [495, 'duplicate', 0.94], [477, 'escalate', 0.76],
    ] as const) {
      const insight = await engine.getIssueInsight({ ...repo, issueNumber: n })
      expect([n, insight.decision, insight.confidence]).toEqual([n, decision, confidence])
    }
    const unknown = await engine.getIssueInsight({ ...repo, issueNumber: 999 })
    expect(unknown.insufficientEvidence).toBe(true)
    expect(unknown.confidence).toBe(0.42)

    const pr = await engine.reviewPullRequest({ ...repo, pullNumber: 201 })
    expect([pr.risk, pr.confidence]).toEqual(['high', 0.86])
    expect(pr.path).toEqual(['auth.ts', 'token.ts', 'refresh.ts'])

    const inv = await engine.investigateIssue({ ...repo, issueNumber: 482 })
    expect(inv.events).toHaveLength(8)
    expect(inv.events.map(e => e.state)).toEqual(['queued','reading','retrieving','comparing','checking_precedent','assessing_impact','deciding','completed'])
    expect(inv.insight.evidence.map(e => e.id)).toEqual(['#331','#402','PR #188'])
    expect(inv.approval?.kind).toBe('add_label')
  })
})
