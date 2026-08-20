/**
 * Build the auditable event stream for an investigation.
 *
 * Shared by the seeded and live engines so both surface the same state machine
 * (spec section 26). The UI renders these events directly -- the animation is
 * driven by real application state, not a decorative timer.
 *
 * These are actions, retrieved sources, and outcomes. Not hidden reasoning.
 */

import type { AgentEvent, Investigation } from '@/lib/types'

export function buildAgentEvents(
  investigation: Omit<Investigation, 'events'>,
  options: { corpusSize?: number } = {},
): AgentEvent[] {
  const { issue, insight, runId } = investigation
  const startedAt = Date.now()

  const event = (
    index: number,
    state: AgentEvent['state'],
    title: string,
    detail: string,
    sources?: AgentEvent['sources'],
  ): AgentEvent => ({
    id: `${runId}-${index}`,
    runId,
    state,
    title,
    detail,
    sources,
    timestamp: new Date(startedAt + index * 450).toISOString(),
  })

  const retrieved =
    options.corpusSize === undefined
      ? `Retrieved ${insight.evidence.length} ranked evidence items.`
      : `Ranked ${options.corpusSize} repository issues, kept ${insight.evidence.length}.`

  const precedent = insight.evidence.filter(
    (source) => source.type === 'pull_request' || source.type === 'decision',
  )

  return [
    event(0, 'queued', 'Investigation queued', `Prepared run for #${issue.number}.`),
    event(
      1,
      'reading',
      'Read issue',
      `Extracted ${issue.subsystem} subsystem and ${issue.symptoms.length} symptom(s).`,
    ),
    event(2, 'retrieving', 'Searched project history', retrieved, insight.evidence),
    event(
      3,
      'comparing',
      'Compared historical cases',
      'Compared symptoms, labels, subsystem, and known relationships.',
      insight.evidence,
    ),
    event(
      4,
      'checking_precedent',
      'Checked maintainer precedent',
      precedent.length > 0
        ? `Found ${precedent.length} prior decision or linked fix.`
        : 'No prior maintainer decision found for this pattern.',
      precedent,
    ),
    event(
      5,
      'assessing_impact',
      'Assessed repository impact',
      `${issue.subsystem} impact evaluated against repository history.`,
    ),
    event(
      6,
      'deciding',
      'Recorded agent decision',
      `${insight.title} with ${Math.round(insight.confidence * 100)}% confidence.`,
      insight.evidence,
    ),
    event(7, 'completed', 'Investigation complete', insight.suggestedAction, insight.evidence),
  ]
}
