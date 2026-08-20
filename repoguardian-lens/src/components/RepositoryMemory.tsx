import { Database, ExternalLink, GitCommit, GitPullRequest, MessagesSquare, Users } from 'lucide-react'

import { openExternal } from '@/lib/format'
import type { RepositoryMemory as RepositoryMemoryData } from '@/lib/types'

export function RepositoryMemory({ memory }: { memory: RepositoryMemoryData }) {
  return (
    <section className="rg-section" aria-labelledby="memory-title">
      <div className="rg-section-heading"><div><span className="rg-eyebrow">Project memory active</span><h2 id="memory-title">Repository memory</h2></div><Database aria-hidden="true" size={20} /></div>
      <div className="rg-indexed-grid">
        <span><GitCommit aria-hidden="true" size={13} /><strong>{memory.indexed.commits.toLocaleString()}</strong> commits</span>
        <span><MessagesSquare aria-hidden="true" size={13} /><strong>{memory.indexed.issues}</strong> issues</span>
        <span><GitPullRequest aria-hidden="true" size={13} /><strong>{memory.indexed.pullRequests}</strong> PRs</span>
        <span><Users aria-hidden="true" size={13} /><strong>{memory.indexed.contributors}</strong> contributors</span>
      </div>
      <div className="rg-memory-tree">
        {memory.groups.map((group) => (
          <div className="rg-memory-group" key={group.subsystem}>
            <h3>{group.subsystem}</h3>
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <span aria-hidden="true" />
                  <button type="button" disabled={!item.url} onClick={() => openExternal(item.url)}>
                    <strong>{item.id}</strong>{item.title}<ExternalLink aria-hidden="true" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
