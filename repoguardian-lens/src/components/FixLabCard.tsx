import { CheckCircle2, FlaskConical, ShieldCheck, XCircle } from 'lucide-react'

import type { FixRun } from '@/lib/types'

type FixLabCardProps = {
  run?: FixRun
  available: boolean
  busy: boolean
  onStart: () => void
  onDecision: (approved: boolean) => void
}

const activeLabels: Record<string, string> = {
  queued: 'Queued',
  preparing: 'Preparing isolated checkout',
  generating: 'Generating a grounded patch',
  verifying: 'Running isolated verification',
  publishing: 'Publishing approved change',
}

export function FixLabCard({ run, available, busy, onStart, onDecision }: FixLabCardProps) {
  return (
    <section className="rg-fix-lab" aria-labelledby="fix-lab-title">
      <div className="rg-fix-lab__heading">
        <div>
          <span className="rg-eyebrow">Verified Fix Lab</span>
          <h2 id="fix-lab-title"><FlaskConical aria-hidden="true" size={16} /> Candidate patch</h2>
        </div>
        <span className="rg-fix-lab__guard"><ShieldCheck aria-hidden="true" size={13} /> sandboxed</span>
      </div>

      {!run && (
        <>
          <p className="rg-fix-lab__copy">
            Generate a patch only from files grounded by this investigation, then test it in a
            read-only, network-disabled container. Nothing is pushed to GitHub.
          </p>
          <button className="rg-button rg-button--primary" type="button" disabled={!available || busy} onClick={onStart}>
            <FlaskConical aria-hidden="true" size={13} />
            {busy ? 'Generating and verifying…' : 'Generate verified fix'}
          </button>
          {!available && <p className="rg-fix-lab__note">Live mode with a configured backend is required.</p>}
        </>
      )}

      {run && activeLabels[run.status] && (
        <div className="rg-fix-lab__status" role="status">
          <span className="rg-loading-pulse" aria-hidden="true" />
          <div><strong>{activeLabels[run.status]}</strong><small>No repository changes have been published.</small></div>
        </div>
      )}

      {run?.status === 'failed' && (
        <>
          <div className="rg-fix-lab__outcome is-failed" role="alert">
            <XCircle aria-hidden="true" size={18} />
            <div><strong>Candidate rejected by the lab</strong><p>{run.error ?? 'Generation or isolated verification failed.'}</p></div>
          </div>
          {run.receipts.length > 0 && (
            <div className="rg-fix-lab__receipts">
              <span className="rg-eyebrow">Failed verification receipts</span>
              {run.receipts.map((receipt, index) => (
                <div className="rg-fix-receipt" key={`${receipt.command.join(' ')}-failed-${index}`}>
                  <code>{receipt.command.join(' ')}</code>
                  <span className="is-failed">exit {receipt.exitCode} · {Math.round(receipt.durationMs / 100) / 10}s</span>
                  <small>{receipt.image}@{receipt.imageDigest.slice(0, 19)} · network disabled</small>
                </div>
              ))}
            </div>
          )}
          {run.patch && <details className="rg-fix-lab__patch"><summary>Review rejected patch</summary><pre>{run.patch}</pre></details>}
        </>
      )}

      {run && ['proposed', 'approved', 'rejected', 'published'].includes(run.status) && (
        <>
          <div className={`rg-fix-lab__outcome ${run.status === 'rejected' ? 'is-failed' : 'is-passed'}`}>
            {run.status === 'rejected' ? <XCircle aria-hidden="true" size={18} /> : <CheckCircle2 aria-hidden="true" size={18} />}
            <div>
              <strong>
                {run.status === 'proposed' && 'Sandbox verification passed'}
                {run.status === 'approved' && 'Candidate approved by maintainer'}
                {run.status === 'rejected' && 'Candidate rejected by maintainer'}
                {run.status === 'published' && 'Change published'}
              </strong>
              <p>{run.summary ?? 'Verified candidate patch.'}</p>
            </div>
          </div>

          {run.receipts.length > 0 && (
            <div className="rg-fix-lab__receipts">
              <span className="rg-eyebrow">Verification receipts</span>
              {run.receipts.map((receipt, index) => (
                <div className="rg-fix-receipt" key={`${receipt.command.join(' ')}-${index}`}>
                  <code>{receipt.command.join(' ')}</code>
                  <span className={receipt.exitCode === 0 ? 'is-passed' : 'is-failed'}>
                    exit {receipt.exitCode} · {Math.round(receipt.durationMs / 100) / 10}s
                  </span>
                  <small>
                    {receipt.containerized && receipt.networkDisabled ? 'container · network disabled' : 'verification constraints incomplete'}
                    {' · '}{receipt.image}@{receipt.imageDigest.slice(0, 19)}
                  </small>
                </div>
              ))}
            </div>
          )}

          {run.patch && <details className="rg-fix-lab__patch"><summary>Review patch</summary><pre>{run.patch}</pre></details>}

          {run.status === 'proposed' && (
            <>
              <div className="rg-action-row">
                <button className="rg-button rg-button--primary" type="button" onClick={() => onDecision(true)}>Approve candidate</button>
                <button className="rg-button" type="button" onClick={() => onDecision(false)}>Reject</button>
              </div>
              <p className="rg-fix-lab__note">Approval records your decision only. This version does not create a branch or pull request.</p>
            </>
          )}

          {run.status === 'approved' && <p className="rg-fix-lab__note">Approved and retained for audit. No branch or pull request has been created.</p>}
        </>
      )}
    </section>
  )
}
