import { AlertTriangle, ArrowRight } from 'lucide-react'

import { formatPercent } from '@/lib/format'
import type { ActivitySummary } from '@/lib/types'

type AttentionItem = ActivitySummary['items'][number]

export function AttentionCard({ item, onOpen }: { item: AttentionItem; onOpen: (issueNumber: number) => void }) {
  return (
    <article className={`rg-attention-card rg-attention-card--${item.severity}`}>
      <div className="rg-attention-icon"><AlertTriangle aria-hidden="true" size={16} /></div>
      <div className="rg-attention-copy">
        <div className="rg-attention-meta">
          <span>#{item.issueNumber}</span>
          <span>{formatPercent(item.confidence)} confidence</span>
        </div>
        <h3>{item.title}</h3>
      </div>
      <button type="button" className="rg-icon-button" onClick={() => onOpen(item.issueNumber)} aria-label={`Inspect issue #${item.issueNumber}`}>
        <ArrowRight aria-hidden="true" size={16} />
      </button>
    </article>
  )
}
