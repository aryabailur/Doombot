import { Database, ExternalLink, GitCommit, GitPullRequest, MessagesSquare, Users } from 'lucide-react'

import { openExternal } from '@/lib/format'
import type { RepositoryMemory as RepositoryMemoryData } from '@/lib/types'

export function RepositoryMemory({ memory }: { memory: RepositoryMemoryData }) {
  const policy = memory.policy
  return (
    <section className="rg-section" aria-labelledby="memory-title">
      <div className="rg-section-heading"><div><span className="rg-eyebrow">Project memory active</span><h2 id="memory-title">Repository memory</h2></div><Database aria-hidden="true" size={20} /></div>
      <div className="rg-indexed-grid">
        <span><GitCommit aria-hidden="true" size={13} /><strong>{memory.indexed.commits.toLocaleString()}</strong> commits</span>
        <span><MessagesSquare aria-hidden="true" size={13} /><strong>{memory.indexed.issues}</strong> issues</span>
        <span><GitPullRequest aria-hidden="true" size={13} /><strong>{memory.indexed.pullRequests}</strong> PRs</span>
        <span><Users aria-hidden="true" size={13} /><strong>{memory.indexed.contributors}</strong> contributors</span>
      </div>
      {policy && (
        <div className="rg-memory-group">
          <h3>Maintainer policy · {policy.mode}</h3>
          <p>
            {policy.totalDecisions === 0
              ? `Learning starts after decisions are recorded; ${policy.minimumSamples} are required before guidance is calibrated.`
              : `${policy.approvals} of ${policy.totalDecisions} proposed actions approved (${Math.round((policy.approvalRate ?? 0) * 100)}%).`}
          </p>
          <ul>
            {policy.actions.map((profile) => (
              <li key={profile.action}>
                <span aria-hidden="true" />
                <div>
                  <strong>{profile.action.replaceAll('_', ' ')}</strong>{' '}
                  {profile.approvals}/{profile.samples} approved · {profile.guidance}
                </div>
              </li>
            ))}
            {policy.learnedRules.map((rule) => (
              <li key={rule}><span aria-hidden="true" /><div>{rule}</div></li>
            ))}
          </ul>
        </div>
      )}
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
