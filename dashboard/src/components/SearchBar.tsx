import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'

const EXAMPLES = [
  'performance complaints nobody responded to',
  'security reports still open',
  'bugs about authentication that were closed',
  'the most discussed issues this year',
]

/**
 * The search entry point, mounted in the AppShell toolbar so it sits at the top
 * of every page.
 *
 * Submits on Enter rather than searching as you type. Stage 1 of the search is a
 * model round-trip (~1.5s warm), so per-keystroke search would fire a model call
 * per character and race its own results back into the list. A 250ms debounce
 * only smooths the URL update; the request itself waits for a real submit.
 */
export function SearchBar() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  const [showExamples, setShowExamples] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Keep the box in step with the URL: arriving on /search?q=... from a link,
  // or going back, should show the query that produced the results on screen.
  useEffect(() => {
    setValue(params.get('q') ?? '')
  }, [params])

  // "/" focuses search, the way GitHub and most code hosts do it. Ignored while
  // the caret is already in a field, or the shortcut would eat a typed slash.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (event.key === '/' && !typing) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setShowExamples(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function submit(query: string) {
    const trimmed = query.trim()
    if (!trimmed) return
    setShowExamples(false)
    inputRef.current?.blur()
    navigate(`/search?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 md:max-w-xl">
      <label className="sr-only" htmlFor="repo-search">
        Search issues by meaning
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
      />
      <input
        ref={inputRef}
        id="repo-search"
        type="search"
        autoComplete="off"
        value={value}
        placeholder="Ask about this repository…  (press /)"
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => setShowExamples(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit(value)
          if (event.key === 'Escape') {
            setShowExamples(false)
            inputRef.current?.blur()
          }
        }}
        className="h-9 w-full rounded-lg border-2 border-border bg-surface-1 pl-9 pr-9 text-sm text-text-primary shadow-brutal-sm outline-none placeholder:text-text-muted focus-visible:border-accent"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setValue('')
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-primary"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}

      {/* Examples, not autocomplete. The hard part of this feature is knowing
          that a plain-English question works at all -- an empty box looks like
          keyword search, so nobody types a sentence into it. */}
      {showExamples && !value ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border-2 border-border bg-surface-1 shadow-brutal">
          <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Ask in plain English
          </p>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onMouseDown={(event) => {
                // mousedown, not click: the input's blur would close this menu
                // before a click ever lands.
                event.preventDefault()
                submit(example)
              }}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
