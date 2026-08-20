/**
 * Server-renders every Stream D component, including its empty and error
 * paths.
 *
 * Why this exists: `tsc --noEmit` and `npm run build` both passed while two
 * real defects were present -- lucide-react had dropped the `Github` icon and
 * Recharts' labelFormatter signature had changed. Neither is a type error at
 * the callsite; both crash at render. This catches that class of breakage
 * without needing a browser or a full test framework.
 *
 * Run: npm run render-check
 */
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { EscalationTable } from '@/components/EscalationTable'
import { EscalationPreview } from '@/components/EscalationPreview'
import { HealthScoreCard } from '@/components/HealthScoreCard'
import { HealthTrendChart } from '@/components/HealthTrendChart'
import { AgentActivityFeed } from '@/components/AgentActivityFeed'
import { AgentStatusIndicator } from '@/components/AgentStatusIndicator'
import { OnboardingPipeline } from '@/components/OnboardingPipeline'
import { RepositorySelector } from '@/components/RepositorySelector'
import { SeverityBadge, VisibilityBadge } from '@/components/SeverityBadge'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { SkeletonState } from '@/components/SkeletonState'
import { AppShell } from '@/components/AppShell'
import { InvestigationList } from '@/components/InvestigationList'
import { IssueGraph } from '@/components/IssueGraph'
import * as d from '@/demo/demoData'
import * as m from '@/lib/mocks'

const checks: [string, () => string][] = [
  ['EmptyState', () => renderToString(<EmptyState title="None" />)],
  ['ErrorState/rate_limited', () => renderToString(<ErrorState kind="rate_limited" />)],
  ['ErrorState/auth', () => renderToString(<ErrorState kind="auth" />)],
  ['SkeletonState/list', () => renderToString(<SkeletonState variant="list" />)],
  ['SeverityBadge/critical', () => renderToString(<SeverityBadge severity="critical" />)],
  ['VisibilityBadge/private', () => renderToString(<VisibilityBadge isPublic={false} />)],
  ['HealthScoreCard', () => renderToString(<HealthScoreCard components={d.demoHealthComponents} overallScore={62} trend="up" />)],
  ['HealthTrendChart', () => renderToString(<HealthTrendChart data={d.demoHealthTrend} />)],
  ['HealthTrendChart/empty', () => renderToString(<HealthTrendChart data={[]} />)],
  ['AgentActivityFeed', () => renderToString(<AgentActivityFeed items={d.demoActivity} />)],
  ['AgentStatusIndicator', () => renderToString(<AgentStatusIndicator connectionState="connected" githubConnected lastSyncAt={new Date().toISOString()} />)],
  ['RepositorySelector', () => renderToString(<RepositorySelector repos={d.demoRepos} selectedRepo={d.demoRepos[0]} onSelect={()=>{}} onIndexRequested={async()=>{}} />)],
  ['RepositorySelector/add', () => renderToString(<RepositorySelector repos={d.demoRepos} selectedRepo={d.demoRepos[0]} onSelect={()=>{}} onIndexRequested={async()=>{}} onAddRepository={async()=>{}} />)],
  ['RepositorySelector/empty+add', () => renderToString(<RepositorySelector repos={[]} onSelect={()=>{}} onIndexRequested={async()=>{}} onAddRepository={async()=>{}} />)],
  ['OnboardingPipeline/running', () => renderToString(<OnboardingPipeline repoName="acme/app" currentStep="Searching for duplicate issues" events={[{stage:'connect',status:'done',message:'Connected to acme/app'},{stage:'index',status:'done',message:'Embedded 42 issue(s)',indexed:42},{stage:'scan',status:'done',message:'Selecting issues'},{stage:'investigate',status:'running',message:'Investigating #7',index:2,total:5}]} />)],
  ['OnboardingPipeline/error', () => renderToString(<OnboardingPipeline repoName="bad/name" events={[{stage:'connect',status:'error',message:'Could not reach bad/name'}]} />)],
  ['EscalationTable', () => renderToString(<EscalationTable rows={d.demoEscalations} filters={{}} onSelect={()=>{}} onFiltersChange={()=>{}} selectedId="esc-1" />)],
  ['EscalationTable/empty', () => renderToString(<EscalationTable rows={[]} filters={{}} onSelect={()=>{}} onFiltersChange={()=>{}} />)],
  ['EscalationTable/filtered-out', () => renderToString(<EscalationTable rows={d.demoEscalations} filters={{severity:['critical'],minConfidence:0.99}} onSelect={()=>{}} onFiltersChange={()=>{}} />)],
  ['EscalationPreview', () => renderToString(<EscalationPreview escalation={d.demoEscalations[0]} onApprove={async()=>{}} onReject={async()=>{}} onCorrect={async()=>{}} onOpenInvestigation={()=>{}} />)],
  ['EscalationPreview/null', () => renderToString(<EscalationPreview escalation={null} onApprove={async()=>{}} onReject={async()=>{}} onCorrect={async()=>{}} onOpenInvestigation={()=>{}} />)],
  ['AppShell', () => renderToString(<MemoryRouter><AppShell>content</AppShell></MemoryRouter>)],
  ['IssueGraph', () => renderToString(<IssueGraph nodes={d.demoGraphNodes} links={d.demoGraphLinks} />)],
  ['IssueGraph/empty', () => renderToString(<IssueGraph nodes={[]} links={[]} />)],
  ['IssueGraph/code', () => renderToString(<IssueGraph codeGraph={m.mockCodeGraph} />)],
  ['InvestigationList', () => renderToString(<InvestigationList investigations={m.mockInvestigations} onSelect={()=>{}} />)],
  ['InvestigationList/loading', () => renderToString(<InvestigationList investigations={null} onSelect={()=>{}} />)],
  ['InvestigationList/error', () => renderToString(<InvestigationList investigations={[]} error="boom" onSelect={()=>{}} />)],
]

let failed = 0
for (const [name, fn] of checks) {
  try {
    const html = fn()
    if (!html || html.length < 10) throw new Error('rendered empty')
    console.log(`  OK    ${name}  (${html.length} chars)`)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${name}: ${(e as Error).message}`)
  }
}
console.log(failed === 0 ? '\nall components render' : `\n${failed} FAILED`)
