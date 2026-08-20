import { AlertTriangle, ArrowDown, FileCode2 } from 'lucide-react'

import { formatPercent } from '@/lib/format'
import type { PRReview } from '@/lib/types'
import { EvidenceChip } from './EvidenceChip'

export function PRRiskCard({ review }: { review: PRReview }) {
  const hasEvidence = review.evidence.length > 0
  return (
    <section className={`rg-decision rg-decision--${review.risk === 'high' ? 'danger' : 'uncertain'}`}>
      <div className="rg-decision-header">
        <div className="rg-decision-icon"><AlertTriangle aria-hidden="true" size={18} /></div>
        <div><span className="rg-eyebrow">Guardian review</span><h2>{review.risk} repository risk</h2></div>
        <div className="rg-confidence"><strong>{formatPercent(review.confidence)}</strong><span>confidence</span></div>
      </div>
      <p className="rg-decision-summary">{review.summary}</p>
      <div className="rg-risk-bar"><span style={{ width: formatPercent(review.confidence) }} /></div>
      {review.path.length > 0 && (
        <div className="rg-impact-path" aria-label={`Potential regression path: ${review.path.join(' to ')}`}>
          {review.path.map((file, index) => (
            <div key={file}><span><FileCode2 aria-hidden="true" size={13} /> {file}</span>{index < review.path.length - 1 && <ArrowDown aria-hidden="true" size={13} />}</div>
          ))}
        </div>
      )}
      {hasEvidence ? (
        <div className="rg-evidence-list">{review.evidence.map((source) => <EvidenceChip evidence={source} key={source.id} />)}</div>
      ) : (
        <div className="rg-insufficient"><AlertTriangle aria-hidden="true" size={14} /> Insufficient live repository evidence. No high-risk claim was made.</div>
      )}
    </section>
  )
}
