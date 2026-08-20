/**
 * Manual end-to-end check against the real GitHub API.
 *
 * Not part of `npm test`: it needs network access and spends the
 * unauthenticated rate-limit budget (60 requests/hour).
 *
 *   npx vitest run src/background/agent/live.manual.ts
 */
import { describe, expect, it } from 'vitest'

import { LiveAgentEngine } from './LiveAgentEngine'

describe('LiveAgentEngine against real GitHub', () => {
  it('analyses a live repository end to end', async () => {
    const engine = new LiveAgentEngine()
    const target = { owner: 'pallets', repo: 'flask' }

    const context = await engine.getRepositoryContext(target)
    console.log('\n=== REPOSITORY CONTEXT ===')
    console.log(`${context.owner}/${context.repo} @ ${context.branch}`)
    console.log(`open issues: ${context.openIssues} | open PRs: ${context.openPullRequests}`)
    console.log(`contributors: ${context.activeContributors} | duplicate rate: ${context.duplicateRate}% | health: ${context.healthScore}`)

    const health = await engine.getRepositoryHealth(target)
    console.log('\n=== HEALTH ===')
    console.log(`score ${health.score}: ${health.interpretation}`)
    for (const metric of health.metrics) console.log(`  ${metric.label}: ${metric.value} (${metric.change})`)

    const activity = await engine.getActivity(target)
    console.log('\n=== ATTENTION ===')
    console.log(`${activity.automatedCount} handled automatically, ${activity.attentionCount} need attention`)
    for (const item of activity.items) console.log(`  #${item.issueNumber} [${item.severity}] ${item.confidence} — ${item.title}`)

    const memory = await engine.getRepositoryMemory(target)
    console.log('\n=== MEMORY ===')
    console.log('indexed:', memory.indexed)
    for (const group of memory.groups) console.log(`  ${group.subsystem}: ${group.items.length} item(s)`)

    if (activity.items.length > 0) {
      const investigation = await engine.investigateIssue({ ...target, issueNumber: activity.items[0].issueNumber })
      console.log('\n=== INVESTIGATION ===')
      console.log(`#${investigation.issue.number} ${investigation.issue.title}`)
      console.log(`subsystem: ${investigation.issue.subsystem} | env: ${investigation.issue.environment ?? 'none'}`)
      console.log(`DECISION: ${investigation.insight.decision} @ ${investigation.insight.confidence}`)
      console.log(`summary: ${investigation.insight.summary}`)
      for (const factor of investigation.insight.factors) console.log(`  - ${factor}`)
      console.log('evidence:')
      for (const source of investigation.insight.evidence) console.log(`  ${source.id} ${source.score ?? ''} — ${source.reason}`)
      console.log(`events: ${investigation.events.map((event) => event.state).join(' -> ')}`)
      console.log(`approval: ${investigation.approval ? `${investigation.approval.kind} (${investigation.approval.status})` : 'none'}`)
      expect(investigation.events).toHaveLength(8)
    }

    const answer = await engine.answerQuestion({ ...target, question: 'What should I care about?' })
    console.log('\n=== ASK ===')
    console.log(`answer: ${answer.answer}`)
    console.log(`confidence: ${answer.confidence} | evidence: ${answer.evidence.length}`)

    expect(context.openIssues).toBeGreaterThan(0)
    expect(health.score).toBeGreaterThanOrEqual(0)
    expect(health.score).toBeLessThanOrEqual(100)
  }, 60000)
})
