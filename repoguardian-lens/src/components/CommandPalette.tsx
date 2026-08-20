import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { ArrowRight, Search, X } from 'lucide-react'

const COMMANDS = [
  'What should I care about?',
  'Why is this issue important?',
  'Find similar bugs',
  'Is this PR risky?',
  'What changed recently?',
  'Show authentication incidents',
  'Why did you escalate this?',
]

export function CommandPalette({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (question: string) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const matches = COMMANDS.filter((command) => command.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  if (!open) return null

  const choose = (value: string) => {
    onSubmit(value)
    onClose()
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((index) => Math.min(matches.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const value = query.trim() || matches[selected]
      if (value) choose(value)
    } else if (event.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="rg-command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="rg-command" role="dialog" aria-modal="true" aria-labelledby="command-title">
        <div className="rg-command-title"><span aria-hidden="true">◈</span><h2 id="command-title">Ask RepoGuardian</h2><button type="button" onClick={onClose} aria-label="Close command palette"><X aria-hidden="true" size={16} /></button></div>
        <div className="rg-command-input"><Search aria-hidden="true" size={18} /><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0) }} onKeyDown={keyDown} placeholder="Ask repository memory…" aria-label="Ask repository memory" /></div>
        <div className="rg-command-list" role="listbox" aria-label="Suggested questions">
          {matches.map((command, index) => (
            <button type="button" role="option" aria-selected={index === selected} className={index === selected ? 'is-selected' : ''} key={command} onMouseEnter={() => setSelected(index)} onClick={() => choose(command)}>
              <span>{command}</span><ArrowRight aria-hidden="true" size={14} />
            </button>
          ))}
          {matches.length === 0 && <button type="button" className="is-selected" onClick={() => choose(query)}><span>Ask “{query}”</span><ArrowRight aria-hidden="true" size={14} /></button>}
        </div>
        <footer><span>Project memory active</span><kbd>↑↓</kbd> navigate <kbd>↵</kbd> ask</footer>
      </section>
    </div>
  )
}
