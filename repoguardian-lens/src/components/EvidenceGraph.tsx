import { motion, useReducedMotion } from 'framer-motion'

import { formatPercent, openExternal } from '@/lib/format'
import type { Insight } from '@/lib/types'

type Point = { x: number; y: number }

export function EvidenceGraph({ issueNumber, insight }: { issueNumber: number; insight: Insight }) {
  const reduceMotion = useReducedMotion()
  const sources = insight.evidence.slice(0, 3)
  const sourcePoints: Point[] = [{ x: 74, y: 52 }, { x: 200, y: 32 }, { x: 326, y: 52 }]
  const issue = { x: 200, y: 130 }
  const decision = { x: 200, y: 220 }

  return (
    <section className="rg-section" aria-labelledby="graph-title">
      <div className="rg-section-heading">
        <div><span className="rg-eyebrow">Evidence</span><h2 id="graph-title">Decision graph</h2></div>
      </div>
      <svg className="rg-evidence-graph" viewBox="0 0 400 270" role="img" aria-label={`${sources.length} evidence items support the ${insight.title} decision`}>
        <defs>
          <linearGradient id="rg-edge" x1="0" x2="1"><stop stopColor="#22D3EE" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient>
          <filter id="rg-glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {sources.map((source, index) => {
          const point = sourcePoints[index]
          return (
            <g key={source.id}>
              <motion.path
                d={`M ${point.x} ${point.y + 23} L ${issue.x} ${issue.y - 26}`}
                stroke="url(#rg-edge)" strokeWidth="1.5" fill="none" opacity="0.65"
                initial={reduceMotion ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduceMotion ? 0 : 0.55, delay: index * 0.12 }}
              />
              <g className={source.url ? 'rg-graph-node rg-graph-node--clickable' : 'rg-graph-node'} onClick={() => openExternal(source.url)} role={source.url ? 'link' : undefined} tabIndex={source.url ? 0 : undefined} onKeyDown={(event) => { if (source.url && (event.key === 'Enter' || event.key === ' ')) openExternal(source.url) }}>
                <rect x={point.x - 48} y={point.y - 22} width="96" height="46" rx="8" />
                <text x={point.x} y={point.y - 2}>{source.id}</text>
                <text className="rg-graph-sub" x={point.x} y={point.y + 14}>{source.score ? formatPercent(source.score) : source.type.replace('_', ' ')}</text>
              </g>
            </g>
          )
        })}
        <motion.path d={`M ${issue.x} ${issue.y + 27} L ${decision.x} ${decision.y - 25}`} stroke="url(#rg-edge)" strokeWidth="2" fill="none" initial={reduceMotion ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduceMotion ? 0 : 0.55, delay: 0.4 }} />
        <g className="rg-graph-node rg-graph-node--current">
          <rect x={issue.x - 52} y={issue.y - 26} width="104" height="54" rx="10" />
          <text x={issue.x} y={issue.y - 3}>#{issueNumber}</text><text className="rg-graph-sub" x={issue.x} y={issue.y + 15}>current issue</text>
        </g>
        <g className={`rg-graph-node rg-graph-node--decision rg-graph-node--${insight.decision}`} filter="url(#rg-glow)">
          <rect x={decision.x - 62} y={decision.y - 25} width="124" height="52" rx="10" />
          <text x={decision.x} y={decision.y - 3}>{insight.title.toUpperCase()}</text><text className="rg-graph-sub" x={decision.x} y={decision.y + 15}>{formatPercent(insight.confidence)}</text>
        </g>
      </svg>
    </section>
  )
}
