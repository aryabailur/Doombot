import { AlertTriangle, Check, CircleDot, Radio } from 'lucide-react'

const STATUS = {
  online: { label: 'Agent Online', icon: Radio },
  investigating: { label: 'Investigating', icon: CircleDot },
  complete: { label: 'Complete', icon: Check },
  attention: { label: 'Needs You', icon: AlertTriangle },
} as const

export function AgentPill({ status }: { status: keyof typeof STATUS }) {
  const value = STATUS[status]
  const showPulse = status === 'online' || status === 'investigating'
  return (
    <span className={`rg-agent-pill rg-agent-pill--${status}`} aria-label={`Agent status: ${value.label}`}>
      {showPulse ? (
        <span className="rg-agent-dot-wrap" aria-hidden="true" style={{ position: 'relative', display: 'inline-flex', width: '8px', height: '8px', flexShrink: 0 }}>
          <span className="rg-animate-pulse-ring" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'currentColor' }} />
          <span className="rg-animate-pulse-dot" style={{ position: 'relative', width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor' }} />
        </span>
      ) : (
        <value.icon aria-hidden="true" size={10} />
      )}
      {value.label}
    </span>
  )
}
