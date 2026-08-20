import { Check, LockKeyhole, ShieldCheck, X } from 'lucide-react'

import type { ApprovalAction } from '@/lib/types'
import { EvidenceChip } from './EvidenceChip'

export function ApprovalTray({
  action,
  onDecision,
}: {
  action: ApprovalAction
  onDecision: (action: ApprovalAction, approved: boolean) => void
}) {
  if (action.status !== 'proposed') {
    return (
      <section className={`rg-approval-result rg-approval-result--${action.status}`}>
        {action.status === 'approved' ? <Check aria-hidden="true" size={15} /> : <X aria-hidden="true" size={15} />}
        <div><strong>Action {action.status}</strong><span>Demo state updated locally. No GitHub write occurred.</span></div>
      </section>
    )
  }

  return (
    <section className="rg-approval" aria-labelledby="approval-title">
      <div className="rg-approval-heading"><ShieldCheck aria-hidden="true" size={18} /><div><span className="rg-eyebrow">Agent proposed action</span><h2 id="approval-title">{action.title}</h2></div></div>
      <div className="rg-proposed-copy">
        <span className="rg-eyebrow"><LockKeyhole aria-hidden="true" size={11} /> Exact GitHub change</span>
        <p>{action.detail}</p>
      </div>
      <p>{action.reason}</p>
      <div className="rg-evidence-list">{action.evidence.map((source) => <EvidenceChip evidence={source} compact key={source.id} />)}</div>
      <div className="rg-action-row">
        <button className="rg-button rg-button--primary" type="button" onClick={() => onDecision(action, true)}>Approve</button>
        <button className="rg-button" type="button" onClick={() => onDecision(action, false)}>Reject</button>
      </div>
      <small>No live GitHub mutation occurs in demo mode.</small>
    </section>
  )
}
