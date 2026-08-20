import type { ApprovalAction, Insight, IssueRecord } from '@/lib/types'

import { fixedEvidence, searchRepositoryMemory } from './retrieval'

export function decideIssue(issue: IssueRecord): { insight: Insight; approval?: ApprovalAction } {
  if (issue.number === 482) {
    const evidence = fixedEvidence('issue331', 'issue402', 'pr188')
    return {
      insight: {
        title: 'Escalate',
        summary: 'Likely regression in token rotation after the v2.4 authentication refactor.',
        confidence: 0.94,
        decision: 'escalate',
        evidence,
        factors: [
          'Same authentication subsystem',
          'Same token lifecycle',
          'Matching failure pattern',
          'Recent related code change',
        ],
        suggestedAction: 'Review the token rotation changes introduced in v2.4.',
      },
      approval: {
        id: 'label-482-security-sensitive',
        kind: 'add_label',
        title: 'Add label: security-sensitive',
        detail: 'security-sensitive',
        reason: 'Issue #482 matches historical authentication incidents.',
        evidence,
        status: 'proposed',
      },
    }
  }

  if (issue.number === 476) {
    return {
      insight: {
        title: 'Stay silent',
        summary: 'A matching historical report already has a known resolution and no new regression signal is present.',
        confidence: 0.88,
        decision: 'silent',
        evidence: fixedEvidence('issue331', 'pr72'),
        factors: [
          'Symptoms match a resolved issue',
          'PR #72 contains the known resolution',
          'No new evidence of regression',
        ],
        suggestedAction: 'Do not interrupt maintainers; preserve the decision for later review.',
      },
    }
  }

  if (issue.number === 491) {
    const evidence = fixedEvidence('issue271', 'issue303')
    const detail =
      'Please provide reproduction steps, your operating system, Node.js version, and approximate request frequency.'
    return {
      insight: {
        title: 'Needs information',
        summary: 'The report is related to known retry failures, but it lacks the details needed to reproduce the behavior.',
        confidence: 0.81,
        decision: 'follow_up',
        evidence,
        factors: ['Missing reproduction steps', 'Missing operating system', 'Missing Node.js version', 'Missing request frequency'],
        suggestedAction: detail,
      },
      approval: {
        id: 'comment-491-request-information',
        kind: 'request_information',
        title: 'Request focused reproduction details',
        detail,
        reason: 'Historical cases #271 and #303 required the same information.',
        evidence,
        status: 'proposed',
      },
    }
  }

  if (issue.number === 495) {
    return {
      insight: {
        title: 'Duplicate',
        summary: 'The report matches the component, symptom, and environment of canonical issue #382.',
        confidence: 0.94,
        decision: 'duplicate',
        evidence: fixedEvidence('issue382', 'issue401'),
        factors: ['Same settings/configuration component', 'Same application-freeze symptom', 'Same Windows 11 environment'],
        suggestedAction: 'Link #495 to canonical issue #382 after maintainer approval.',
      },
      approval: {
        id: 'link-495-382',
        kind: 'link_issue',
        title: 'Link duplicate to #382',
        detail: 'Mark #495 as a duplicate of #382.',
        reason: 'The deterministic retrieval score is 94% with matching component, symptom, and environment.',
        evidence: fixedEvidence('issue382', 'issue401'),
        status: 'proposed',
      },
    }
  }

  if (issue.number === 477) {
    return {
      insight: {
        title: 'Escalate',
        summary: 'A production migration is blocked and a recent lock-handling change is relevant.',
        confidence: 0.76,
        decision: 'escalate',
        evidence: fixedEvidence('pr205'),
        factors: ['Production impact', 'Database migration path', 'Recent lock-handling change'],
        suggestedAction: 'Review lock waits and the changes introduced by PR #205.',
      },
    }
  }

  const evidence = searchRepositoryMemory({
    query: issue.title,
    repository: 'acme/payments-api',
    issue,
    limit: 2,
  }).filter((item) => (item.score ?? 0) >= 0.65)

  return {
    insight: {
      title: 'Insufficient evidence',
      summary: 'Related reports exist, but the available evidence does not establish a shared underlying bug.',
      confidence: 0.42,
      decision: 'silent',
      evidence,
      factors: ['No reliable reproduction steps', 'Environment is unknown', 'Historical relationship is below the escalation threshold'],
      suggestedAction: 'Request reproduction steps, environment, and affected version.',
      insufficientEvidence: true,
    },
  }
}
