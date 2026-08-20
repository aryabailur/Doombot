import { AlertTriangle, Check, CircleDot, Radio } from 'lucide-react'

const STATUS = {
  online: { label: 'Online', icon: Radio },
  investigating: { label: 'Investigating', icon: CircleDot },
  complete: { label: 'Complete', icon: Check },
  attention: { label: 'Attention', icon: AlertTriangle },
} as const

export function AgentPill({ status }: { status: keyof typeof STATUS }) {
  const value = STATUS[status]
  const Icon = value.icon
  return (
    <span className={`rg-agent-pill rg-agent-pill--${status}`} aria-label={`Agent status: ${value.label}`}>
      <Icon aria-hidden="true" size={12} />
      {value.label}
    </span>
  )
}
