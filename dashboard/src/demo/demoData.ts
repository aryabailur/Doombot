import type { ActivityItem } from '@/components/AgentActivityFeed'
import type { EscalationRow } from '@/components/EscalationTable'
import type { HealthComponentScore } from '@/components/HealthMetricBreakdown'
import type { HealthTrendPoint } from '@/components/HealthTrendChart'
import type { RepoSummary } from '@/components/RepositorySelector'

/**
 * Fixtures for the shell until Stream A's endpoints exist.
 *
 * Content is deliberately realistic, not lorem ipsum: judges read this on
 * screen, and scripts/CLAUDE.md makes the same rule for the backend seed
 * script. These mirror the real issues the agent triaged on
 * aryabailur/Doombot, so the fixture story and the live story match.
 *
 * Timestamps are relative to load so nothing reads as stale during a demo.
 */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

export const demoRepos: RepoSummary[] = [
  {
    repo_name: 'aryabailur/Doombot',
    health_score: 62,
    open_investigations: 3,
    last_scan: minutesAgo(4),
  },
  {
    repo_name: 'psf/requests',
    health_score: 78,
    open_investigations: 1,
    last_scan: minutesAgo(52),
  },
]

export const demoEscalations: EscalationRow[] = [
  {
    id: 'esc-1',
    severity: 'critical',
    category: 'security',
    title: 'Credential leaked in traceback after v2.1 upgrade',
    issueRef: '#4',
    confidence: 0.93,
    openedAt: minutesAgo(12),
    status: 'pending',
    // Private: DESIGN.md 12 prohibits publishing a suspected vulnerability
    // without approval, so this must look different from a public row.
    isPublicVisibility: false,
  },
  {
    id: 'esc-2',
    severity: 'high',
    category: 'regression',
    title: 'Login fails with 401 after upgrading to v2.1',
    issueRef: '#3',
    confidence: 0.81,
    openedAt: minutesAgo(46),
    status: 'pending',
    isPublicVisibility: true,
  },
  {
    id: 'esc-3',
    severity: 'warning',
    category: 'duplicate',
    title: 'Login broken with 401 after v2.1 upgrade',
    issueRef: '#6',
    confidence: 0.99,
    openedAt: minutesAgo(58),
    status: 'pending',
    isPublicVisibility: true,
  },
  {
    id: 'esc-4',
    severity: 'info',
    category: 'question',
    title: 'Dark mode toggle does nothing',
    issueRef: '#5',
    confidence: 0.64,
    openedAt: minutesAgo(180),
    status: 'approved',
    isPublicVisibility: true,
  },
]

/** Weights are DESIGN.md 7.5's initial configuration; they sum to 1.0. */
export const demoHealthComponents: HealthComponentScore[] = [
  { key: 'response', label: 'Response health', weight: 0.25, score: 58 },
  { key: 'backlog', label: 'Backlog stability', weight: 0.2, score: 71 },
  { key: 'resolution', label: 'Issue resolution', weight: 0.2, score: 64 },
  {
    key: 'pr_responsiveness',
    label: 'PR responsiveness',
    weight: 0.15,
    score: 82,
  },
  { key: 'contributor', label: 'Contributor activity', weight: 0.1, score: 44 },
  { key: 'duplicate_rate', label: 'Duplicate rate', weight: 0.1, score: 39 },
]

export const demoHealthTrend: HealthTrendPoint[] = [
  { date: daysAgo(28), score: 54 },
  { date: daysAgo(24), score: 57 },
  {
    date: daysAgo(20),
    score: 49,
    annotation: { label: 'v2.1 released', kind: 'release' },
  },
  { date: daysAgo(16), score: 52 },
  { date: daysAgo(12), score: 58 },
  {
    date: daysAgo(8),
    score: 55,
    annotation: { label: 'Auth regression reported', kind: 'incident' },
  },
  { date: daysAgo(4), score: 60 },
  { date: daysAgo(0), score: 62 },
]

export const demoActivity: ActivityItem[] = [
  {
    id: 'act-1',
    message: 'Escalated #4 — potential credential leak',
    timestamp: minutesAgo(12),
    kind: 'escalation',
  },
  {
    id: 'act-2',
    message: 'Awaiting approval to comment on #4',
    timestamp: minutesAgo(12),
    kind: 'approval_needed',
  },
  {
    id: 'act-3',
    message: 'Closed #6 as a duplicate of #3 (similarity 1.00)',
    timestamp: minutesAgo(58),
    kind: 'action_taken',
  },
  {
    id: 'act-4',
    message: 'Investigated #6 — searched 5 indexed issues',
    timestamp: minutesAgo(59),
    kind: 'investigation',
  },
  {
    id: 'act-5',
    message: 'Applied labels bug, security to #4',
    timestamp: minutesAgo(74),
    kind: 'action_taken',
  },
  {
    id: 'act-6',
    message: 'Investigated #3 — no duplicates above threshold',
    timestamp: minutesAgo(96),
    kind: 'investigation',
  },
]
