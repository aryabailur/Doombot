import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Activity,
  Boxes,
  BrainCircuit,
  PanelLeftClose,
  PanelLeftOpen,
  Network,
  Search,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export interface AppShellProps {
  children: ReactNode
  /** Rendered in the top bar: repository selector, status, etc. */
  toolbar?: ReactNode
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const navItems: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: Activity },
  { to: '/escalations', label: 'Escalations', icon: TriangleAlert },
  { to: '/investigations', label: 'Investigations', icon: Search },
  { to: '/graph', label: 'Graph', icon: Network },
  { to: '/explorer', label: 'Explorer', icon: Boxes },
  { to: '/health', label: 'Health', icon: Activity },
]

/**
 * Persistent chrome: collapsible sidebar plus a top bar (F13).
 *
 * Routes are flat, per FRONTEND-D.md -- a nested-route tree buys nothing at
 * five screens and costs debugging time.
 *
 * NavLink sets aria-current="page" on the active route, so the current
 * location is conveyed to a screen reader rather than only by a highlighted
 * background (dashboard/CLAUDE.md 8).
 */
export function AppShell({ children, toolbar }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex min-h-screen bg-background text-text-primary">
      <nav
        aria-label="Main navigation"
        className={cn(
          'flex shrink-0 flex-col gap-1 border-r border-border bg-surface-1 p-2 transition-[width]',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        <div className="flex items-center gap-2 px-1 py-2">
          <BrainCircuit
            aria-hidden="true"
            className="size-5 shrink-0 text-accent"
          />
          {!collapsed ? (
            <span className="truncate text-sm font-semibold">Doombot</span>
          ) : null}
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="ml-auto rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-bright"
            onClick={() => setCollapsed((open) => !open)}
            type="button"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>

        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-bright',
                  isActive
                    ? 'bg-surface-3 font-medium text-text-primary'
                    : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                )
              }
              key={item.to}
              title={collapsed ? item.label : undefined}
              to={item.to}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </NavLink>
          )
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-1 px-4 py-3">
          {toolbar}
        </header>
        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>
    </div>
  )
}
