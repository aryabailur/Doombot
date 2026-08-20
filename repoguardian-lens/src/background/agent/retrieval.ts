import type { EvidenceSource, IssueRecord } from '@/lib/types'

import { EVIDENCE } from './seededRepository'

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
  'why',
  'with',
])

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
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

export function fixedEvidence(...keys: Array<keyof typeof EVIDENCE>): EvidenceSource[] {
  return keys.map((key) => EVIDENCE[key])
}
