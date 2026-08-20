import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, CircleDot, Play } from 'lucide-react'

import type { AgentEvent } from '@/lib/types'
import { EvidenceChip } from './EvidenceChip'

export function AgentRunTimeline({ events, onComplete }: { events: AgentEvent[]; onComplete?: () => void }) {
  const reduceMotion = useReducedMotion()
  const [visibleCount, setVisibleCount] = useState(reduceMotion ? events.length : 1)

  const replay = () => setVisibleCount(reduceMotion ? events.length : 1)

  useEffect(() => {
    if (visibleCount >= events.length) {
      onComplete?.()
      return
    }
    if (reduceMotion) return
    const timer = setTimeout(() => setVisibleCount((count) => Math.min(events.length, count + 1)), 480)
    return () => clearTimeout(timer)
  }, [events.length, onComplete, reduceMotion, visibleCount])

  return (
    <section className="rg-section" aria-labelledby="run-title">
      <div className="rg-section-heading">
        <div>
          <span className="rg-eyebrow">Agent run</span>
          <h2 id="run-title">Investigation trace</h2>
        </div>
        <button className="rg-text-button rg-dev-replay" type="button" onClick={replay} title="Development demo replay">
          <Play aria-hidden="true" size={12} /> Play investigation
        </button>
      </div>
      <ol className="rg-timeline" aria-live="polite">
        {events.slice(0, visibleCount).map((event, index) => {
          const isActive = index === visibleCount - 1 && visibleCount < events.length
          return (
            <motion.li
              key={event.id}
              className={isActive ? 'rg-timeline-step rg-timeline-step--active' : 'rg-timeline-step'}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.38 }}
            >
              <div className="rg-step-marker">
                {isActive ? <CircleDot aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}
              </div>
              <div className="rg-step-copy">
                <div><span>{String(index + 1).padStart(2, '0')}</span><strong>{event.title}</strong></div>
                {event.detail && <p>{event.detail}</p>}
                {event.sources && event.sources.length > 0 && (
                  <div className="rg-evidence-list">
                    {event.sources.slice(0, 3).map((source) => <EvidenceChip evidence={source} compact key={source.id} />)}
                  </div>
                )}
              </div>
            </motion.li>
          )
        })}
      </ol>
    </section>
  )
}
