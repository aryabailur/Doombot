export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function repositoryUrl(owner: string, repo: string, path = ''): string {
  return `https://github.com/${owner}/${repo}${path}`
}

export function openExternal(url?: string): void {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}
