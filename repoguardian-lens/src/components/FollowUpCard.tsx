import { Check, Square } from 'lucide-react'

import type { ApprovalAction, Insight } from '@/lib/types'
import { EvidenceChip } from './EvidenceChip'

export function FollowUpCard({
  insight,
  approval,
  onApprove,
}: {
  insight: Insight
  approval?: ApprovalAction
  onApprove: (action: ApprovalAction, approved: boolean) => void
}) {
  return (
    <section className="rg-section rg-follow-up" aria-labelledby="follow-up-title">
      <div className="rg-section-heading"><div><span className="rg-eyebrow">Needs information</span><h2 id="follow-up-title">Focused follow-up</h2></div></div>
      <ul className="rg-checklist">
        {insight.factors.filter((factor) => factor.startsWith('Missing')).map((factor) => (
          <li key={factor}><Square aria-hidden="true" size={14} /> {factor.replace('Missing ', '')}</li>
        ))}
      </ul>
      <div className="rg-proposed-copy">
        <span className="rg-eyebrow">Exact proposed comment</span>
        <p>{approval?.detail ?? insight.suggestedAction}</p>
      </div>
      <div className="rg-evidence-list">{insight.evidence.map((source) => <EvidenceChip compact evidence={source} key={source.id} />)}</div>
      {approval && approval.status === 'proposed' && (
        <div className="rg-action-row">
          <button className="rg-button rg-button--primary" type="button" onClick={() => onApprove(approval, true)}>Approve demo action</button>
          <button className="rg-button" type="button" onClick={() => onApprove(approval, false)}>Reject</button>
        </div>
      )}
      {approval && approval.status !== 'proposed' && (
        <p className={`rg-action-result rg-action-result--${approval.status}`}><Check aria-hidden="true" size={14} /> Action {approval.status} and stored locally.</p>
      )}
    </section>
  )
}
