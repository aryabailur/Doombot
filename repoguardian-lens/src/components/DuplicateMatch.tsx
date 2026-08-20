import { CheckCircle2, ExternalLink } from 'lucide-react'

import { formatPercent, openExternal } from '@/lib/format'
import type { DuplicateResult } from '@/lib/types'

export function DuplicateMatch({ matches }: { matches: DuplicateResult[] }) {
  if (matches.length === 0) {
    return <div className="rg-empty-state"><span>◌</span><strong>No duplicate candidates passed the threshold</strong><p>The agent will preserve this as an independent report.</p></div>
  }

  return (
    <section className="rg-section" aria-labelledby="duplicates-title">
      <div className="rg-section-heading"><div><span className="rg-eyebrow">Semantic duplicate detection</span><h2 id="duplicates-title">Historical matches</h2></div></div>
      <div className="rg-duplicate-list">
        {matches.map((match) => (
          <article className="rg-duplicate" key={match.issue.id}>
            <div className="rg-duplicate-header">
              <div>
                <span className="rg-mono">{match.issue.id}</span>
                <h3>{match.issue.title}</h3>
              </div>
              <strong>{formatPercent(match.similarity)}</strong>
            </div>
            <div className="rg-similarity-track" aria-label={`${formatPercent(match.similarity)} similarity`}>
              <span style={{ width: formatPercent(match.similarity) }} />
            </div>
            <dl>
              <div><dt>Component</dt><dd>{match.sameComponent}</dd></div>
              <div><dt>Symptom</dt><dd>{match.sameSymptom}</dd></div>
              {match.sameEnvironment && <div><dt>Environment</dt><dd>{match.sameEnvironment}</dd></div>}
            </dl>
            <div className="rg-action-row">
              {match.canonical && <span className="rg-canonical"><CheckCircle2 aria-hidden="true" size={13} /> Canonical issue</span>}
              <button className="rg-text-button" type="button" onClick={() => openExternal(match.issue.url)}>
                Open issue <ExternalLink aria-hidden="true" size={12} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
