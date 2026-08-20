/**
 * Decide what to do about a real issue, from real evidence.
 *
 * The seeded engine in decisions.ts keys off issue numbers, which is correct
 * for the scripted demo. This module cannot do that: it sees whatever issue the
 * maintainer happened to open. Every decision here is derived from the
 * retrieval scores, the issue text, and the repository's own labels.
 *
 * The thresholds are deliberately conservative. Overstating confidence on live
 * data is the one failure this product cannot afford (spec section 15), so when
 * the evidence is thin the answer is "insufficient evidence" rather than a
 * plausible-sounding guess.
 */

import type { ApprovalAction, EvidenceSource, Insight, IssueRecord } from '@/lib/types'

import { toEvidence, type RetrievalResult } from './retrieval'

/** A near-identical historical report. Below this it is "related", not "same". */
const DUPLICATE_THRESHOLD = 0.72
/** Enough corroboration to justify interrupting a maintainer. */
const ESCALATE_THRESHOLD = 0.45
/** Below this, no claim is made at all. */
const EVIDENCE_FLOOR = 0.3

const SECURITY_KEYWORDS = [
  'security',
  'vulnerab',
  'exploit',
  'injection',
  'xss',
  'csrf',
  'auth bypass',
  'privilege',
  'rce',
  'cve-',
  'sensitive data',
  'credential leak',
]

const REGRESSION_KEYWORDS = [
  'regression',
  'used to work',
  'worked before',
  'after upgrading',
  'after updating',
  'since version',
  'broke after',
  'no longer works',
]

/** What a maintainer needs before a bug report is actionable. */
function missingInformation(issue: IssueRecord): string[] {
  const body = issue.body.toLowerCase()
  const missing: string[] = []
  if (!/\b(?:step|reproduc|repro|to reproduce)\b/.test(body)) missing.push('reproduction steps')
  if (!issue.environment) missing.push('operating system or runtime version')
  if (!/\b(?:v?\d+\.\d+|version)\b/.test(body)) missing.push('affected version')
  if (body.trim().length < 120) missing.push('a fuller description of the problem')
  return missing
}

function has(text: string, keywords: string[]): string | undefined {
  const haystack = text.toLowerCase()
  return keywords.find((keyword) => haystack.includes(keyword))
}

function strip(results: RetrievalResult[]): EvidenceSource[] {
  // whyMatched is retrieval-internal; the UI reads `reason`.
  return results.map(toEvidence)
}

export function decideLiveIssue(input: {
  issue: IssueRecord
  matches: RetrievalResult[]
  repository: string
}): { insight: Insight; approval?: ApprovalAction } {
  const { issue, matches, repository } = input
  const usable = matches.filter((match) => (match.score ?? 0) >= EVIDENCE_FLOOR)
  const evidence = strip(usable)
  const strongest = usable[0]
  const top = strongest?.score ?? 0

  const securityHit = has(`${issue.title} ${issue.body} ${issue.labels.join(' ')}`, SECURITY_KEYWORDS)
  const regressionHit = has(`${issue.title} ${issue.body}`, REGRESSION_KEYWORDS)
  const missing = missingInformation(issue)

  // Duplicate first: if an existing report already covers this, nothing else
  // matters -- linking it is both the cheapest and the most useful outcome.
  if (top >= DUPLICATE_THRESHOLD && strongest) {
    const canonical = strongest.id
    return {
      insight: {
        title: 'Duplicate',
        summary: `This report closely matches ${canonical}: ${strongest.whyMatched}.`,
        confidence: Number(top.toFixed(2)),
        decision: 'duplicate',
        evidence,
        factors: [
          `Similarity to ${canonical} is ${Math.round(top * 100)}%`,
          strongest.subsystem ? `Same ${strongest.subsystem} subsystem` : 'Shared terminology',
          'An existing report already tracks this behavior',
        ],
        suggestedAction: `Link this issue to ${canonical} after maintainer approval.`,
      },
      approval: {
        id: `link-${issue.number}-${canonical.replace(/\D/g, '')}`,
        kind: 'link_issue',
        title: `Link duplicate to ${canonical}`,
        detail: `Mark #${issue.number} as a duplicate of ${canonical}.`,
        reason: `Retrieval scored ${Math.round(top * 100)}% similarity: ${strongest.whyMatched}.`,
        evidence,
        status: 'proposed',
      },
    }
  }

  // Security next: a credible security signal is worth a maintainer's
  // attention even when the historical evidence is thin, but the confidence
  // reported stays modest because keyword matching is layer-1 only.
  if (securityHit) {
    const confidence = Number(Math.min(0.78, 0.52 + top * 0.3).toFixed(2))
    return {
      insight: {
        title: 'Escalate',
        summary: `The report references ${securityHit}, which the repository treats as security-sensitive.`,
        confidence,
        decision: 'escalate',
        evidence,
        factors: [
          `Security-sensitive language: "${securityHit}"`,
          evidence.length > 0 ? `${evidence.length} related historical report(s)` : 'No historical precedent found',
          'Keyword-level detection only; not a static audit',
        ],
        suggestedAction: 'Triage as potentially security-sensitive and confirm the impact manually.',
      },
      approval: {
        id: `label-${issue.number}-security-sensitive`,
        kind: 'add_label',
        title: 'Add label: security-sensitive',
        detail: 'security-sensitive',
        reason: `The issue text contains "${securityHit}".`,
        evidence,
        status: 'proposed',
      },
    }
  }

  // A regression claim with corroborating history is the strongest ordinary
  // escalation case: something that used to work now does not.
  if (regressionHit && top >= ESCALATE_THRESHOLD && strongest) {
    const confidence = Number(Math.min(0.88, 0.55 + top * 0.35).toFixed(2))
    return {
      insight: {
        title: 'Escalate',
        summary: `Reported as a regression and corroborated by ${strongest.id}: ${strongest.whyMatched}.`,
        confidence,
        decision: 'escalate',
        evidence,
        factors: [
          `Regression language: "${regressionHit}"`,
          `Strongest related report ${strongest.id} at ${Math.round(top * 100)}%`,
          strongest.subsystem ? `Same ${strongest.subsystem} subsystem` : 'Shared terminology',
        ],
        suggestedAction: `Compare against ${strongest.id} and identify the change that altered this behavior.`,
      },
    }
  }

  // Missing information blocks progress regardless of how the evidence scored,
  // so ask for it rather than escalating an unreproducible report.
  if (missing.length >= 2) {
    const detail = `Please provide ${missing.slice(0, 4).join(', ')}.`
    // Deliberately capped below the escalation band. High certainty that a
    // report is thin is not a reason to rank it above a credential leak.
    const confidence = Number(Math.min(0.6, 0.4 + missing.length * 0.05).toFixed(2))
    return {
      insight: {
        title: 'Needs information',
        summary: 'The report is missing details a maintainer would need before it can be acted on.',
        confidence,
        decision: 'follow_up',
        evidence,
        factors: missing.map((item) => `Missing ${item}`),
        suggestedAction: detail,
      },
      approval: {
        id: `comment-${issue.number}-request-information`,
        kind: 'request_information',
        title: 'Request focused reproduction details',
        detail,
        reason: `${missing.length} required details are absent from the report.`,
        evidence,
        status: 'proposed',
      },
    }
  }

  // Related history but no regression or security signal: record the link and
  // stay quiet. This is the decision that proves the agent is selective.
  if (top >= ESCALATE_THRESHOLD && strongest) {
    return {
      insight: {
        title: 'Stay silent',
        summary: `Related prior work exists (${strongest.id}) and there is no regression or security signal that warrants an interruption.`,
        confidence: Number(Math.min(0.85, 0.5 + top * 0.4).toFixed(2)),
        decision: 'silent',
        evidence,
        factors: [
          `${strongest.id} covers similar ground at ${Math.round(top * 100)}%`,
          'No regression language in the report',
          'No security-sensitive terms detected',
        ],
        suggestedAction: 'No maintainer interruption; the related history is recorded for later review.',
      },
    }
  }

  // Default: say so plainly. Never fake confidence (spec section 15).
  return {
    insight: {
      title: 'Insufficient evidence',
      summary:
        evidence.length > 0
          ? 'Related reports exist, but the evidence does not establish a shared underlying bug.'
          : `No comparable history was found in ${repository} for this report.`,
      confidence: Number(Math.max(0.2, Math.min(0.44, top)).toFixed(2)),
      decision: 'silent',
      evidence,
      factors: [
        evidence.length > 0
          ? `Strongest match reached only ${Math.round(top * 100)}%`
          : 'No related issues passed the retrieval floor',
        ...missing.map((item) => `Missing ${item}`),
      ].slice(0, 4),
      suggestedAction:
        missing.length > 0
          ? `Request ${missing.slice(0, 3).join(', ')} before triaging further.`
          : 'Review manually; the repository history does not resolve this report.',
      insufficientEvidence: true,
    },
  }
}
