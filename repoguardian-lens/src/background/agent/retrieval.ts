import type { EvidenceSource, IssueRecord } from '@/lib/types'

import { EVIDENCE } from './seededRepository'

export type { IssueRecord }

const STOP_WORDS = new Set([
  'a',
  'after',
  'and',
  'are',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'the',
  'to',
  'what',
  'when',
  'why',
  'with',
  'was',
  'not',
  'now',
  'but',
  'get',
  'gets',
  'got',
  'this',
  'that',
  'have',
  'has',
  'been',
  'does',
  'doing',
  'still',
  'also',
  'any',
  'all',
])

/**
 * Fold tokens that mean the same thing to a maintainer.
 *
 * Two reports of one bug rarely share vocabulary exactly -- "login broken"
 * versus "login fails" -- so without this the strongest duplicate signal is
 * split across synonyms and never clears the threshold.
 */
const SYNONYMS: Record<string, string> = {
  break: 'fail',
  broke: 'fail',
  broken: 'fail',
  fails: 'fail',
  failed: 'fail',
  failing: 'fail',
  failure: 'fail',
  error: 'fail',
  errors: 'fail',
  crash: 'fail',
  crashes: 'fail',
  upgrade: 'upgrade',
  upgraded: 'upgrade',
  upgrading: 'upgrade',
  update: 'upgrade',
  updated: 'upgrade',
  updating: 'upgrade',
  auth: 'authenticate',
  authentication: 'authenticate',
  authenticating: 'authenticate',
  login: 'authenticate',
  logon: 'authenticate',
  signin: 'authenticate',
  token: 'token',
  tokens: 'token',
  expire: 'expire',
  expires: 'expire',
  expired: 'expire',
  expiring: 'expire',
  hang: 'hang',
  hangs: 'hang',
  freeze: 'hang',
  freezes: 'hang',
  stuck: 'hang',
}

/** Strip a trailing plural so "sessions" and "session" match. */
function normalizeToken(token: string): string {
  const folded = SYNONYMS[token]
  if (folded) return folded
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
      .map(normalizeToken),
  )
}

function overlapScore(query: Set<string>, candidate: Set<string>): number {
  if (query.size === 0 || candidate.size === 0) return 0
  const intersection = [...query].filter((token) => candidate.has(token)).length
  return intersection / Math.sqrt(query.size * candidate.size)
}

export type RetrievalResult = EvidenceSource & { whyMatched: string }

export function searchRepositoryMemory(input: {
  query: string
  repository: string
  issue?: IssueRecord
  limit?: number
}): RetrievalResult[] {
  const queryTokens = tokenize(
    `${input.query} ${input.issue?.title ?? ''} ${input.issue?.body ?? ''} ${input.issue?.symptoms.join(' ') ?? ''}`,
  )

  return Object.values(EVIDENCE)
    .map((evidence) => {
      const candidateTokens = tokenize(
        `${evidence.title} ${evidence.reason} ${evidence.subsystem ?? ''} ${evidence.labels?.join(' ') ?? ''}`,
      )
      const lexical = overlapScore(queryTokens, candidateTokens)
      const subsystemMatch = input.issue?.subsystem === evidence.subsystem ? 0.18 : 0
      const labelMatch = input.issue?.labels.some((label) => evidence.labels?.includes(label)) ? 0.08 : 0
      const seededPrior = evidence.score ?? 0.45
      const score = Math.min(0.99, seededPrior * 0.62 + lexical * 0.25 + subsystemMatch + labelMatch)
      const whyMatched = [
        subsystemMatch ? `same ${evidence.subsystem} subsystem` : '',
        labelMatch ? 'matching repository labels' : '',
        lexical > 0 ? 'overlapping symptoms and terminology' : '',
      ]
        .filter(Boolean)
        .join(', ')

      return {
        ...evidence,
        score: Number(score.toFixed(2)),
        whyMatched: whyMatched || evidence.reason,
      }
    })
    .filter((result) => (result.score ?? 0) >= 0.45)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, input.limit ?? 6)
}

/** Drop retrieval-internal fields, leaving the EvidenceSource the UI reads. */
export function toEvidence(result: RetrievalResult): EvidenceSource {
  return {
    id: result.id,
    type: result.type,
    title: result.title,
    url: result.url,
    score: result.score,
    reason: result.reason,
    subsystem: result.subsystem,
    labels: result.labels,
  }
}

export function fixedEvidence(...keys: Array<keyof typeof EVIDENCE>): EvidenceSource[] {
  return keys.map((key) => EVIDENCE[key])
}

/**
 * Rank real repository issues against a target issue.
 *
 * Deliberately the same shape as searchRepositoryMemory: tokenize, score
 * lexical overlap, boost same-subsystem and shared-label matches. The
 * difference is the corpus -- live issues fetched from GitHub rather than the
 * seeded evidence table -- and the absence of a seeded prior, because there is
 * no curated relationship to lean on. Scores here are honest similarity, not
 * the scripted demo confidences.
 *
 * Replacing this with embeddings later means changing only this function
 * (spec section 44).
 */
export function searchLiveIssues(input: {
  target: IssueRecord
  corpus: IssueRecord[]
  repository: string
  limit?: number
}): RetrievalResult[] {
  const { target, corpus, repository } = input
  const queryTokens = tokenize(
    `${target.title} ${target.body} ${target.symptoms.join(' ')}`,
  )

  return corpus
    .filter((candidate) => candidate.number !== target.number)
    .map((candidate) => {
      const candidateTokens = tokenize(
        `${candidate.title} ${candidate.body} ${candidate.symptoms.join(' ')} ${candidate.labels.join(' ')}`,
      )
      // Title-only overlap as well as full-text: two short reports of the same
      // bug share most of their title tokens but little else, and cosine over
      // the whole body dilutes that signal below any useful threshold.
      const titleOverlap = overlapScore(
        tokenize(target.title),
        tokenize(candidate.title),
      )
      const lexical = Math.max(overlapScore(queryTokens, candidateTokens), titleOverlap)
      const subsystemMatch = candidate.subsystem === target.subsystem && candidate.subsystem !== 'general' ? 0.16 : 0
      const sharedLabels = candidate.labels.filter((label) => target.labels.includes(label))
      const labelMatch = sharedLabels.length > 0 ? Math.min(0.1, sharedLabels.length * 0.05) : 0
      const environmentMatch =
        target.environment && candidate.environment && target.environment.toLowerCase() === candidate.environment.toLowerCase()
          ? 0.06
          : 0

      // Lexical overlap carries the score: with no curated prior, similarity
      // has to come from the text itself or the number is meaningless.
      //
      // Capped below 1.0 because synonym folding can make two differently
      // worded reports look textually identical. They are near-identical, not
      // the same text, and the number shown should not claim otherwise.
      const score = Math.min(
        0.95,
        lexical * 0.74 + subsystemMatch + labelMatch + environmentMatch,
      )

      const whyMatched = [
        subsystemMatch ? `same ${candidate.subsystem} subsystem` : '',
        sharedLabels.length > 0 ? `shared ${sharedLabels.slice(0, 2).join(', ')} label${sharedLabels.length > 1 ? 's' : ''}` : '',
        environmentMatch ? `same ${candidate.environment} environment` : '',
        lexical > 0.1 ? 'overlapping terminology' : '',
      ]
        .filter(Boolean)
        .join(', ')

      return {
        id: `#${candidate.number}`,
        type: 'issue' as const,
        title: candidate.title,
        url: `https://github.com/${repository}/issues/${candidate.number}`,
        score: Number(score.toFixed(2)),
        reason: whyMatched || 'weak textual similarity',
        subsystem: candidate.subsystem,
        labels: candidate.labels,
        whyMatched: whyMatched || 'weak textual similarity',
      }
    })
    .filter((result) => (result.score ?? 0) >= 0.3)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, input.limit ?? 6)
}
