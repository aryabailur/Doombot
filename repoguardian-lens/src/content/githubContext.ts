import type { GitHubContext } from '@/lib/types'

const NON_REPOSITORY_ROOTS = new Set([
  'about',
  'apps',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'signup',
  'sponsors',
  'topics',
  'trending',
])

export function detectGitHubContext(location: Location): GitHubContext {
  if (location.hostname !== 'github.com' && location.hostname !== 'www.github.com') {
    return { type: 'unknown' }
  }

  const parts = location.pathname.split('/').filter(Boolean)
  if (parts.length < 2 || NON_REPOSITORY_ROOTS.has(parts[0].toLowerCase())) {
    return { type: 'unknown' }
  }

  const [owner, repo, section, rawNumber] = parts
  if (!owner || !repo || repo.endsWith('.git')) return { type: 'unknown' }

  if (section === 'issues' && /^\d+$/.test(rawNumber ?? '')) {
    return { type: 'issue', owner, repo, issueNumber: Number(rawNumber) }
  }

  if (section === 'pull' && /^\d+$/.test(rawNumber ?? '')) {
    return { type: 'pull_request', owner, repo, pullNumber: Number(rawNumber) }
  }

  return { type: 'repository', owner, repo }
}
