import { useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, Copy, Search, ShieldAlert } from 'lucide-react'

import { formatPercent } from '@/lib/format'
import type { DecisionFeedback, Insight } from '@/lib/types'
import { EvidenceChip } from './EvidenceChip'

const DECISION_META = {
  escalate: { icon: ShieldAlert, className: 'danger' },
  silent: { icon: CheckCircle2, className: 'success' },
  follow_up: { icon: CircleHelp, className: 'warning' },
  duplicate: { icon: Copy, className: 'primary' },
} as const

export function DecisionCard({
  insight,
  issueNumber,
  onInvestigate,
  onFindDuplicates,
  onFeedback,
}: {
  insight: Insight
  issueNumber: number
  onInvestigate: () => void
  onFindDuplicates: () => void
  onFeedback: (feedback: DecisionFeedback) => void
}) {
  const [showWhy, setShowWhy] = useState(false)
  const [feedback, setFeedback] = useState<'no' | 'saved' | null>(null)
  const meta = DECISION_META[insight.decision]
  const Icon = insight.insufficientEvidence ? AlertTriangle : meta.icon

  const record = (useful: boolean, reason?: DecisionFeedback['reason']) => {
    setFeedback('saved')
    onFeedback({ issueNumber, useful, reason, createdAt: new Date().toISOString() })
  }

  return (
    <section className={`rg-decision rg-decision--${insight.insufficientEvidence ? 'uncertain' : meta.className}`}>
      <div className="rg-decision-header">
        <div className="rg-decision-icon"><Icon aria-hidden="true" size={18} /></div>
        <div>
          <span className="rg-eyebrow">{insight.insufficientEvidence ? 'Insufficient evidence' : 'Agent decision'}</span>
          <h2>{insight.title}</h2>
        </div>
        <div className="rg-confidence">
          <strong>{formatPercent(insight.confidence)}</strong>
          <span>confidence</span>
        </div>
      </div>
      <p className="rg-decision-summary">{insight.summary}</p>
      {insight.evidence.length > 0 ? (
        <div className="rg-evidence-list">
          {insight.evidence.map((source) => <EvidenceChip evidence={source} key={source.id} />)}
        </div>
      ) : (
        <div className="rg-insufficient"><AlertTriangle aria-hidden="true" size={14} /> No ranked evidence passed the decision threshold.</div>
      )}
      <button className="rg-text-button" type="button" aria-expanded={showWhy} onClick={() => setShowWhy((value) => !value)}>
        <Search aria-hidden="true" size={14} /> {showWhy ? 'Hide rationale' : 'Why this decision?'}
      </button>
      {showWhy && (
        <div className="rg-why-panel">
          <span className="rg-eyebrow">Decision factors</span>
          <ul>{insight.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
          <strong>Suggested next action</strong>
          <p>{insight.suggestedAction}</p>
        </div>
      )}
      <div className="rg-action-row">
        <button className="rg-button rg-button--primary" type="button" onClick={onInvestigate}>Investigate</button>
        {insight.decision === 'duplicate' && (
          <button className="rg-button" type="button" onClick={onFindDuplicates}>Compare matches</button>
        )}
      </div>
      <div className="rg-feedback">
        {feedback === 'saved' ? (
          <p><CheckCircle2 aria-hidden="true" size={14} /> Feedback saved locally.</p>
        ) : feedback === 'no' ? (
          <div>
            <span>Why?</span>
            <div className="rg-feedback-options">
              {([
                ['wrong_duplicate', 'Wrong duplicate'],
                ['wrong_priority', 'Wrong priority'],
                ['missing_evidence', 'Missing evidence'],
                ['other', 'Other'],
              ] as const).map(([reason, label]) => (
                <button type="button" key={reason} onClick={() => record(false, reason)}>{label}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="rg-feedback-prompt">
            <span>Was this decision useful?</span>
            <button type="button" onClick={() => record(true)}>Yes</button>
            <button type="button" onClick={() => setFeedback('no')}>No</button>
          </div>
        )}
      </div>
    </section>
  )
}
