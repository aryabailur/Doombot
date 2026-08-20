import { FormEvent, useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  Database,
  ExternalLink,
  GitBranch,
  HeartPulse,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'

import { openExternal, repositoryUrl } from '@/lib/format'
import type { GitHubContext, LensView } from '@/lib/types'
import { useLensStore } from '@/store/useLensStore'
import { AgentPill } from './AgentPill'
import { AgentRunTimeline } from './AgentRunTimeline'
import { ApprovalTray } from './ApprovalTray'
import { AskAgent } from './AskAgent'
import { AttentionCard } from './AttentionCard'
import { DecisionCard } from './DecisionCard'
import { DuplicateMatch } from './DuplicateMatch'
import { EvidenceGraph } from './EvidenceGraph'
import { FollowUpCard } from './FollowUpCard'
import { HealthSnapshot } from './HealthSnapshot'
import { PRRiskCard } from './PRRiskCard'
import { RepositoryMemory } from './RepositoryMemory'

function ContextLabel({ context }: { context: GitHubContext }) {
  if (context.type === 'unknown') return <span>Global GitHub context</span>
  const suffix = context.type === 'issue' ? ` / issue #${context.issueNumber}` : context.type === 'pull_request' ? ` / PR #${context.pullNumber}` : ''
  return <span><strong>{context.owner}/{context.repo}</strong>{suffix}</span>
}

function StoryLoading({ label }: { label: string }) {
  return (
    <div className="rg-story-loading" role="status">
      <span className="rg-loading-pulse" />
      <div><strong>{label}</strong><p>#331 · #402 · PR #188 · #417</p><small>4 evidence items ranked</small></div>
    </div>
  )
}

function RepositoryXRay() {
  const [url, setUrl] = useState('https://github.com/acme/payments-api')
  const [stage, setStage] = useState<'idle' | 'analyzing' | 'complete'>('idle')
  const reduceMotion = useReducedMotion()

  const analyze = (event: FormEvent) => {
    event.preventDefault()
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url.trim())) return
    setStage('analyzing')
    window.setTimeout(() => setStage('complete'), reduceMotion ? 0 : 950)
  }

  if (stage === 'complete') {
    return (
      <section className="rg-section rg-xray-result">
        <div className="rg-section-heading"><div><span className="rg-eyebrow">Repository X-ray</span><h2>Three emerging hotspots</h2></div><strong className="rg-health-score">91<span>/100</span></strong></div>
        <div className="rg-hotspot-list"><span className="is-danger">Authentication</span><span>Routing</span><span>Database migrations</span></div>
        <dl className="rg-change-list"><div><dt>Contributor activity</dt><dd>↑ 14%</dd></div><div><dt>PR velocity</dt><dd>↑ 22%</dd></div><div><dt>Response time</dt><dd>↓ 8%</dd></div></dl>
        <p className="rg-agent-take">Authentication has the highest concentration of unresolved issues in the last 30 days.</p>
        <button className="rg-text-button" type="button" onClick={() => setStage('idle')}><RotateCcw aria-hidden="true" size={13} /> Analyze another repository</button>
      </section>
    )
  }

  return (
    <section className="rg-section">
      <div className="rg-section-heading"><div><span className="rg-eyebrow">Drop a repository</span><h2>Analyze repository</h2></div></div>
      <form className="rg-repo-input" onSubmit={analyze}>
        <GitBranch aria-hidden="true" size={15} />
        <label className="rg-sr-only" htmlFor="rg-repository-url">GitHub repository URL</label>
        <input id="rg-repository-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required pattern="https://github\.com/[^/]+/[^/]+/?" />
        <button type="submit" disabled={stage === 'analyzing'}><ArrowRight aria-hidden="true" size={15} /></button>
      </form>
      {stage === 'analyzing' && (
        <div className="rg-analysis-progress" role="status">
          <div><span>Building repository memory</span><strong>87%</strong></div>
          <div className="rg-similarity-track"><span style={{ width: '87%' }} /></div>
          <p><Check aria-hidden="true" size={12} /> Structure · issues · pull requests · commits · decisions</p>
        </div>
      )}
    </section>
  )
}

export function LensPanel() {
  const reduceMotion = useReducedMotion()
  const {
    isOpen,
    demoMode,
    context,
    view,
    status,
    repository,
    health,
    activity,
    insight,
    investigation,
    duplicates,
    prReview,
    memory,
    answer,
    loading,
    error,
    close,
    setView,
    setDemoMode,
    initialize,
    runInvestigation,
    loadMemory,
    loadDuplicates,
    ask,
    decideApproval,
    recordFeedback,
    resetDemo,
  } = useLensStore()

  const issueNumber = context.type === 'issue' ? context.issueNumber : undefined
  const repositoryName = demoMode ? 'acme/payments-api' : context.type === 'unknown' ? 'GitHub' : `${context.owner}/${context.repo}`

  const tabs = useMemo<Array<{ id: LensView; label: string; visible: boolean }>>(
    () => [
      { id: 'overview', label: 'Overview', visible: true },
      { id: 'investigation', label: 'Investigate', visible: context.type === 'issue' },
      { id: 'pr', label: 'PR risk', visible: context.type === 'pull_request' },
      { id: 'memory', label: 'Memory', visible: true },
      { id: 'ask', label: 'Ask', visible: true },
    ],
    [context.type],
  )

  const openDemoIssue = (number: number) => {
    void initialize({ type: 'issue', owner: 'acme', repo: 'payments-api', issueNumber: number })
  }

  const retry = () => void initialize(context)
  const markInvestigationComplete = useCallback(() => {
    if (useLensStore.getState().status !== 'complete') {
      useLensStore.setState({ status: 'complete' })
    }
  }, [])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          className="rg-panel"
          initial={reduceMotion ? false : { x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
          aria-label="RepoGuardian Lens"
        >
          <header className="rg-panel-header">
            <div className="rg-brand"><span className="rg-brand-mark" aria-hidden="true">◈</span><div><strong>RepoGuardian</strong><small>Lens</small></div></div>
            <AgentPill status={status} />
            <button className="rg-icon-button" type="button" onClick={close} aria-label="Close RepoGuardian Lens"><X aria-hidden="true" size={17} /></button>
          </header>

          <div className="rg-context-bar">
            <ContextLabel context={context} />
            <span className="rg-demo-badge">{demoMode ? 'Demo mode' : 'Live context'}</span>
          </div>

          <div className="rg-mode-switch" aria-label="Data source">
            <button type="button" className={!demoMode ? 'is-active' : ''} onClick={() => setDemoMode(false)}>Live GitHub</button>
            <button type="button" className={demoMode ? 'is-active' : ''} onClick={() => setDemoMode(true)}><span aria-hidden="true">●</span> Demo repository</button>
          </div>

          <nav className="rg-tabs" aria-label="Lens views">
            {tabs.filter((tab) => tab.visible).map((tab) => (
              <button
                type="button"
                key={tab.id}
                className={view === tab.id ? 'is-active' : ''}
                aria-current={view === tab.id ? 'page' : undefined}
                onClick={() => {
                  if (tab.id === 'memory') void loadMemory()
                  else if (tab.id === 'investigation') void runInvestigation()
                  else setView(tab.id)
                }}
              >{tab.label}</button>
            ))}
          </nav>

          <main className="rg-panel-body" tabIndex={-1}>
            {error && (
              <section className="rg-error-state" role="alert">
                <AlertTriangle aria-hidden="true" size={19} />
                <div><strong>{demoMode ? 'Repository context unavailable' : 'GitHub connection unavailable'}</strong><p>{error}</p><div className="rg-action-row">{!demoMode && <button className="rg-button rg-button--primary" type="button" onClick={() => setDemoMode(true)}>Use demo data</button>}<button className="rg-button" type="button" onClick={retry}>Retry</button></div></div>
              </section>
            )}

            {loading && view !== 'ask' && <StoryLoading label={loading} />}

            {!loading && view === 'overview' && (
              <>
                <section className="rg-repo-hero">
                  <div><span className="rg-eyebrow">Repository intelligence</span><h1>{repositoryName}</h1><p>GitHub shows what exists. RepoGuardian identifies what matters.</p></div>
                  {repository && <div className="rg-hero-score"><HeartPulse aria-hidden="true" size={16} /><strong>{repository.healthScore}</strong><span>health</span></div>}
                </section>

                {context.type === 'issue' && insight && issueNumber && (
                  <>
                    <div className="rg-context-title"><button className="rg-text-button" type="button" onClick={() => void initialize({ type: 'repository', owner: context.owner, repo: context.repo })}><ChevronLeft aria-hidden="true" size={13} /> Repository</button><span>Issue #{issueNumber}</span></div>
                    <DecisionCard insight={insight} issueNumber={issueNumber} onInvestigate={() => void runInvestigation()} onFindDuplicates={() => void loadDuplicates()} onFeedback={(feedback) => void recordFeedback(feedback)} />
                    {insight.decision === 'follow_up' && <FollowUpCard insight={insight} approval={investigation?.approval} onApprove={(action, approved) => void decideApproval(action, approved)} />}
                    {duplicates.length > 0 && <DuplicateMatch matches={duplicates} />}
                    <div className="rg-action-row rg-page-actions">
                      <button className="rg-button" type="button" onClick={() => openExternal(repositoryUrl(context.owner, context.repo, `/issues/${issueNumber}`))}>Open issue <ExternalLink aria-hidden="true" size={12} /></button>
                      <button className="rg-button" type="button" onClick={() => setView('ask')}>Ask RepoGuardian</button>
                    </div>
                  </>
                )}

                {context.type !== 'issue' && (
                  <>
                    {activity && (
                      <section className="rg-section" aria-labelledby="attention-title">
                        <div className="rg-section-heading"><div><span className="rg-eyebrow">What matters</span><h2 id="attention-title">{activity.attentionCount} things need your attention</h2></div><span className="rg-auto-count">{activity.automatedCount} handled automatically</span></div>
                        <div className="rg-attention-list">{activity.items.map((item) => <AttentionCard item={item} onOpen={openDemoIssue} key={item.issueNumber} />)}</div>
                      </section>
                    )}
                    {health && <HealthSnapshot report={health} />}
                    <div className="rg-wide-action"><button className="rg-button rg-button--primary" type="button" onClick={() => void loadMemory()}><Database aria-hidden="true" size={14} /> Explore project memory</button><button className="rg-button" type="button" onClick={() => { setView('ask'); void ask('What should I care about?') }}><Bot aria-hidden="true" size={14} /> What should I care about?</button></div>
                    <RepositoryXRay />
                  </>
                )}
              </>
            )}

            {!loading && view === 'investigation' && issueNumber && (
              investigation ? (
                <>
                  <section className="rg-run-heading"><span className="rg-eyebrow">Issue #{issueNumber}</span><h1>{investigation.issue.title}</h1></section>
                  <AgentRunTimeline events={investigation.events} onComplete={markInvestigationComplete} />
                  <EvidenceGraph issueNumber={issueNumber} insight={investigation.insight} />
                  <DecisionCard insight={investigation.insight} issueNumber={issueNumber} onInvestigate={() => void runInvestigation()} onFindDuplicates={() => void loadDuplicates()} onFeedback={(feedback) => void recordFeedback(feedback)} />
                  {investigation.insight.decision === 'follow_up' && <FollowUpCard insight={investigation.insight} approval={investigation.approval} onApprove={(action, approved) => void decideApproval(action, approved)} />}
                  {investigation.approval && investigation.insight.decision !== 'follow_up' && <ApprovalTray action={investigation.approval} onDecision={(action, approved) => void decideApproval(action, approved)} />}
                  {duplicates.length > 0 && <DuplicateMatch matches={duplicates} />}
                </>
              ) : (
                <div className="rg-empty-state"><Search aria-hidden="true" size={28} /><strong>No investigation has run yet</strong><p>Run the agent to retrieve and rank repository evidence.</p><button className="rg-button rg-button--primary" type="button" onClick={() => void runInvestigation()}>Start investigation</button></div>
              )
            )}

            {!loading && view === 'pr' && (
              prReview ? (
                <><section className="rg-run-heading"><span className="rg-eyebrow">PR #{prReview.pullRequest.number}</span><h1>{prReview.pullRequest.title}</h1></section><PRRiskCard review={prReview} /><div className="rg-action-row rg-page-actions"><button className="rg-button" type="button" onClick={() => context.type === 'pull_request' && openExternal(repositoryUrl(context.owner, context.repo, `/pull/${context.pullNumber}`))}>Open PR <ExternalLink aria-hidden="true" size={12} /></button><button className="rg-button rg-button--primary" type="button" onClick={() => { setView('ask'); void ask('Is this PR risky?') }}>Ask agent</button></div></>
              ) : <div className="rg-empty-state"><AlertTriangle aria-hidden="true" size={28} /><strong>PR context is unavailable</strong><p>Open a GitHub pull request to review repository-history-aware risk.</p></div>
            )}

            {view === 'ask' && <AskAgent answer={answer} loading={Boolean(loading)} onAsk={(question) => void ask(question)} />}
            {!loading && view === 'memory' && (memory ? <RepositoryMemory memory={memory} /> : <div className="rg-empty-state"><Database aria-hidden="true" size={28} /><strong>Repository memory has not loaded</strong><p>Retrieve the deterministic project index to explore historical evidence.</p><button className="rg-button rg-button--primary" type="button" onClick={() => void loadMemory()}>Load memory</button></div>)}
          </main>

          <footer className="rg-panel-footer"><span><span className="rg-live-dot" aria-hidden="true" /> Demo engine offline-ready</span><button className="rg-text-button" type="button" onClick={() => void resetDemo()}><RotateCcw aria-hidden="true" size={12} /> Reset demo</button><kbd>⌘G</kbd></footer>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
