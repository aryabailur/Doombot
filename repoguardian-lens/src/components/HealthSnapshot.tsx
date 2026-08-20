import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

import type { HealthReport } from '@/lib/types'
import { EvidenceChip } from './EvidenceChip'

export function HealthSnapshot({ report }: { report: HealthReport }) {
  return (
    <section className="rg-section" aria-labelledby="health-title">
      <div className="rg-section-heading">
        <div>
          <span className="rg-eyebrow">Repository health</span>
          <h2 id="health-title">Health snapshot</h2>
        </div>
        <div className="rg-health-score" aria-label={`Health score ${report.score} out of 100`}>
          <strong>{report.score}</strong><span>/100</span>
        </div>
      </div>
      <div className="rg-metric-grid">
        {report.metrics.map((metric) => {
          const Icon = metric.direction === 'up' ? ArrowUpRight : ArrowDownRight
          return (
            <div className="rg-metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small className={metric.concern ? 'rg-text-warning' : 'rg-text-success'}>
                <Icon aria-hidden="true" size={12} /> {metric.change}
              </small>
            </div>
          )
        })}
      </div>
      <p className="rg-agent-take">{report.interpretation}</p>
      <div className="rg-evidence-list">
        {report.evidence.map((source) => <EvidenceChip evidence={source} compact key={source.id} />)}
      </div>
    </section>
  )
}
