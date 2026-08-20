import { motion } from 'framer-motion'

export function LensTrigger({
  isOpen,
  attentionCount,
  investigating,
  onClick,
}: {
  isOpen: boolean
  attentionCount: number
  investigating: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      className={`rg-trigger ${investigating ? 'rg-trigger--active' : ''}`}
      aria-label={isOpen ? 'Close RepoGuardian Lens' : 'Open RepoGuardian Lens'}
      aria-expanded={isOpen}
      onClick={onClick}
      whileHover={{ x: -3 }}
      transition={{ duration: 0.15 }}
    >
      <span className="rg-trigger-mark" aria-hidden="true">◈</span>
      <span className="rg-trigger-copy">
        <strong>RepoGuardian</strong>
        <small>{investigating ? 'Investigating' : `${attentionCount} things need you`}</small>
      </span>
      <span className="rg-trigger-dot" aria-hidden="true" />
    </motion.button>
  )
}
