import { FormEvent, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'

import type { GroundedAnswer } from '@/lib/types'
import { EvidenceChip } from './EvidenceChip'

/** Seeded prompts reference the demo repository's issue numbers. */
const DEMO_EXAMPLES = [
  'What should I care about?',
  'Why did you escalate #482?',
  'Is PR #201 risky?',
  'What changed recently?',
]

/** Live prompts must not name issues that may not exist in this repository. */
const LIVE_EXAMPLES = [
  'What should I care about?',
  'Find similar bugs',
  'Show authentication issues',
  'What changed recently?',
]

export function AskAgent({
  answer,
  loading,
  onAsk,
  demoMode,
}: {
  answer?: GroundedAnswer
  loading: boolean
  onAsk: (question: string) => void
  demoMode: boolean
}) {
  const examples = demoMode ? DEMO_EXAMPLES : LIVE_EXAMPLES
  const [question, setQuestion] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = question.trim()
    if (value) onAsk(value)
  }

  return (
    <section className="rg-ask" aria-labelledby="ask-title">
      <div className="rg-section-heading"><div><span className="rg-eyebrow">Project memory active</span><h2 id="ask-title">Ask RepoGuardian</h2></div></div>
      <form onSubmit={submit}>
        <label htmlFor="rg-ask-input">Repository-specific question</label>
        <div className="rg-ask-field">
          <Search aria-hidden="true" size={16} />
          <input
            id="rg-ask-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit(event)
            }}
            placeholder="Why is this issue important?"
            autoComplete="off"
          />
          <button type="submit" disabled={!question.trim() || loading} aria-label="Ask RepoGuardian"><ArrowRight aria-hidden="true" size={16} /></button>
        </div>
      </form>
      <div className="rg-example-list">
        {examples.map((example) => <button type="button" key={example} onClick={() => { setQuestion(example); onAsk(example) }}>{example}</button>)}
      </div>
      {loading && (
        <div className="rg-story-loading" role="status"><span className="rg-loading-pulse" /><div><strong>Searching repository memory</strong><p>{demoMode ? '#331 · #402 · PR #188 · #417' : 'Ranking issues by relevance'}</p></div></div>
      )}
      {answer && !loading && (
        <article className="rg-answer">
          <span className="rg-eyebrow">Answer</span>
          <p>{answer.answer}</p>
          <div className="rg-answer-meta"><span>{Math.round(answer.confidence * 100)}% confidence</span><span>{answer.evidence.length} evidence items</span></div>
          {answer.evidence.length > 0 ? (
            <div className="rg-evidence-list">{answer.evidence.map((source) => <EvidenceChip evidence={source} key={source.id} />)}</div>
          ) : (
            <div className="rg-insufficient">Insufficient evidence</div>
          )}
          <div className="rg-next-action"><strong>Suggested next action</strong><p>{answer.suggestedAction}</p></div>
        </article>
      )}
    </section>
  )
}
