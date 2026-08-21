import type {
  ActivitySummary,
  EvidenceSource,
  HealthReport,
  IssueRecord,
  PullRequestRecord,
  RepositoryContext,
  RepositoryMemory,
} from '@/lib/types'

export const DEMO_REPOSITORY: RepositoryContext = {
  owner: 'acme',
  repo: 'payments-api',
  branch: 'main',
  openIssues: 128,
  openPullRequests: 17,
  activeContributors: 67,
  avgResponseHours: 4.2,
  duplicateRate: 23,
  healthScore: 82,
}

export const DEMO_ISSUES: Record<number, IssueRecord> = {
  482: {
    number: 482,
    title: 'OAuth refresh tokens randomly expiring',
    body: 'Refresh tokens expire after the v2.4 authentication refactor, even when rotation succeeds.',
    subsystem: 'authentication',
    labels: ['bug', 'oauth', 'regression'],
    environment: 'Node.js 22 / Linux',
    symptoms: ['refresh token expires', 'session ends', 'rotation retry'],
  },
  491: {
    number: 491,
    title: 'Rate limit reached after retry',
    body: 'Requests start failing after the client retries a rate-limited response.',
    subsystem: 'routing',
    labels: ['bug', 'needs-triage'],
    symptoms: ['rate limit', 'retry failure'],
  },
  477: {
    number: 477,
    title: 'Database migration hangs',
    body: 'The production migration stops without completing on a large customer database.',
    subsystem: 'database',
    labels: ['bug', 'migration'],
    environment: 'PostgreSQL 16',
    symptoms: ['migration hangs', 'lock wait'],
  },
  476: {
    number: 476,
    title: 'Windows install fails',
    body: 'Installation stops while preparing native authentication dependencies on Windows.',
    subsystem: 'installation',
    labels: ['bug', 'windows'],
    environment: 'Windows 11',
    symptoms: ['installer fails', 'native dependency'],
  },
  495: {
    number: 495,
    title: 'Application freezes after changing configuration',
    body: 'The settings screen becomes unresponsive after a configuration value changes.',
    subsystem: 'settings/configuration',
    labels: ['bug', 'windows'],
    environment: 'Windows 11',
    symptoms: ['application freeze', 'configuration change'],
  },
  498: {
    number: 498,
    title: 'Occasional request timeout',
    body: 'A request timed out once, but no reproduction steps or environment were provided.',
    subsystem: 'unknown',
    labels: ['needs-triage'],
    symptoms: ['timeout'],
  },
}

export const DEMO_PULL_REQUESTS: Record<number, PullRequestRecord> = {
  201: {
    number: 201,
    title: 'Refactor OAuth token rotation',
    files: ['src/auth/auth.ts', 'src/auth/token.ts', 'src/auth/refresh.ts'],
    subsystem: 'authentication',
  },
}

const issueUrl = (number: number) => `https://github.com/acme/payments-api/issues/${number}`
const pullUrl = (number: number) => `https://github.com/acme/payments-api/pull/${number}`

export const EVIDENCE: Record<string, EvidenceSource> = {
  issue331: {
    id: '#331',
    type: 'issue',
    title: 'OAuth token refresh failure on Windows sessions',
    url: issueUrl(331),
    score: 0.91,
    reason: 'Matching token lifecycle failure; includes the same Windows dependency path.',
    subsystem: 'authentication',
    labels: ['oauth', 'windows', 'resolved'],
  },
  issue402: {
    id: '#402',
    type: 'issue',
    title: 'Refresh token expires after retry',
    url: issueUrl(402),
    score: 0.84,
    reason: 'Same retry symptom and refresh-token lifecycle.',
    subsystem: 'authentication',
    labels: ['oauth', 'regression'],
  },
  issue417: {
    id: '#417',
    type: 'issue',
    title: 'Authentication session instability',
    url: issueUrl(417),
    score: 0.76,
    reason: 'Related authentication subsystem and session termination symptom.',
    subsystem: 'authentication',
    labels: ['authentication'],
  },
  pr188: {
    id: 'PR #188',
    type: 'pull_request',
    title: 'Fix refresh token rotation after auth refactor',
    url: pullUrl(188),
    score: 0.87,
    reason: 'Maintainer precedent for escalating token-rotation regressions.',
    subsystem: 'authentication',
    labels: ['fix', 'oauth'],
  },
  pr72: {
    id: 'PR #72',
    type: 'pull_request',
    title: 'Fix Windows installer requirements',
    url: pullUrl(72),
    score: 0.89,
    reason: 'Contains the established resolution for the matching Windows dependency failure.',
    subsystem: 'installation',
    labels: ['windows', 'fix'],
  },
  discussion57: {
    id: 'Discussion #57',
    type: 'discussion',
    title: 'Windows environment requirements',
    url: 'https://github.com/acme/payments-api/discussions/57',
    score: 0.74,
    reason: 'Documents the required Windows toolchain.',
    subsystem: 'installation',
  },
  issue382: {
    id: '#382',
    type: 'issue',
    title: 'UI hangs when changing config',
    url: issueUrl(382),
    score: 0.94,
    reason: 'Same component, freeze symptom, and Windows 11 environment.',
    subsystem: 'settings/configuration',
    labels: ['windows', 'resolved'],
  },
  issue401: {
    id: '#401',
    type: 'issue',
    title: 'Settings page becomes unresponsive',
    url: issueUrl(401),
    score: 0.82,
    reason: 'Same settings component and unresponsive UI symptom.',
    subsystem: 'settings/configuration',
  },
  issue271: {
    id: '#271',
    type: 'issue',
    title: 'Retry policy triggers rate limiter',
    url: issueUrl(271),
    score: 0.79,
    reason: 'Maintainers needed runtime version and request frequency to reproduce it.',
    subsystem: 'routing',
  },
  issue303: {
    id: '#303',
    type: 'issue',
    title: '429 after automatic retry',
    url: issueUrl(303),
    score: 0.77,
    reason: 'Matching retry and rate-limit pattern; resolution depended on reproduction details.',
    subsystem: 'routing',
  },
  issue441: {
    id: '#441',
    type: 'issue',
    title: 'Triage queue response-time review',
    url: issueUrl(441),
    reason: 'Records the recent response-time increase.',
    subsystem: 'maintainer-operations',
  },
  issue467: {
    id: '#467',
    type: 'issue',
    title: 'Contributor activity baseline',
    url: issueUrl(467),
    reason: 'Provides the prior contributor-activity baseline.',
    subsystem: 'maintainer-operations',
  },
  pr182: {
    id: 'PR #182',
    type: 'pull_request',
    title: 'Improve issue triage workflow',
    url: pullUrl(182),
    reason: 'Latest maintainer workflow change linked to response-time data.',
    subsystem: 'maintainer-operations',
  },
  issue211: {
    id: '#211',
    type: 'issue',
    title: 'Payment authorization retry drift',
    url: issueUrl(211),
    reason: 'Representative payments incident in project memory.',
    subsystem: 'payments',
  },
  pr192: {
    id: 'PR #192',
    type: 'pull_request',
    title: 'Normalize payment retry keys',
    url: pullUrl(192),
    reason: 'Resolution linked to payment retry incidents.',
    subsystem: 'payments',
  },
  pr205: {
    id: 'PR #205',
    type: 'pull_request',
    title: 'Avoid migration lock starvation',
    url: pullUrl(205),
    reason: 'Recent database migration change.',
    subsystem: 'database',
  },
}

export const DEMO_ACTIVITY: ActivitySummary = {
  source: 'demo',
  automatedCount: 143,
  attentionCount: 3,
  items: [
    { issueNumber: 482, title: DEMO_ISSUES[482].title, confidence: 0.94, severity: 'critical' },
    { issueNumber: 491, title: DEMO_ISSUES[491].title, confidence: 0.81, severity: 'warning' },
    { issueNumber: 477, title: DEMO_ISSUES[477].title, confidence: 0.76, severity: 'warning' },
  ],
}

export const DEMO_HEALTH: HealthReport = {
  score: 82,
  interpretation:
    'The repository is not yet unhealthy, but maintainer response time increased 31% while contributor activity declined 11%.',
  metrics: [
    { label: 'Backlog', value: '128', change: '+8% / 30d', direction: 'up', concern: true },
    { label: 'Response', value: '4.2h', change: '+31%', direction: 'up', concern: true },
    { label: 'Duplicates', value: '23%', change: '-4%', direction: 'down', concern: false },
    { label: 'Contributors', value: '67', change: '-11%', direction: 'down', concern: true },
  ],
  evidence: [EVIDENCE.issue441, EVIDENCE.issue467, EVIDENCE.pr182],
}

export const DEMO_MEMORY: RepositoryMemory = {
  indexed: { commits: 2418, issues: 483, pullRequests: 219, contributors: 67 },
  groups: [
    {
      subsystem: 'Authentication',
      items: [EVIDENCE.issue331, EVIDENCE.issue402, EVIDENCE.pr188],
    },
    {
      subsystem: 'Payments',
      items: [EVIDENCE.issue211, EVIDENCE.pr192],
    },
    {
      subsystem: 'Database',
      items: [
        {
          id: '#477',
          type: 'issue',
          title: DEMO_ISSUES[477].title,
          url: issueUrl(477),
          reason: 'Current migration incident.',
          subsystem: 'database',
        },
        EVIDENCE.pr205,
      ],
    },
  ],
}
