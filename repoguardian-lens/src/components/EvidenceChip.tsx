import { ExternalLink } from 'lucide-react'

import { formatPercent, openExternal } from '@/lib/format'
import type { EvidenceSource } from '@/lib/types'

export function EvidenceChip({ evidence, compact = false }: { evidence: EvidenceSource; compact?: boolean }) {
  const content = (
    <>
      <span className="rg-evidence-id">{evidence.id}</span>
      {!compact && <span className="rg-evidence-title">{evidence.title}</span>}
      {typeof evidence.score === 'number' && <span className="rg-evidence-score">{formatPercent(evidence.score)}</span>}
      {evidence.url && <ExternalLink aria-hidden="true" size={12} />}
    </>
  )

  return evidence.url ? (
    <button
      className="rg-evidence-chip"
      type="button"
      title={evidence.reason}
      aria-label={`Open evidence ${evidence.id}: ${evidence.title}`}
      onClick={() => openExternal(evidence.url)}
    >
      {content}
    </button>
  ) : (
    <span className="rg-evidence-chip" title={evidence.reason}>
      {content}
    </span>
  )
}
