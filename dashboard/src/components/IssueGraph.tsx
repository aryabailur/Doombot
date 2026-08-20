import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Network } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { SkeletonState } from '@/components/SkeletonState'
import { cn } from '@/lib/utils'

/**
 * react-force-graph-2d touches `window` at module scope, so a static import
 * throws "window is not defined" anywhere there is no DOM -- which breaks
 * the render-check harness and would break SSR or a prerender step.
 *
 * Lazy-loading also keeps it out of the initial bundle: it pulls in d3-force
 * and is by far the heaviest dependency in the dashboard, and four of the
 * five routes never need it.
 */
const ForceGraph2D = lazy(() => import('react-force-graph-2d'))

/**
 * The library types graph nodes as its own loose `NodeObject` (an index
 * signature plus optional simulation coordinates), so our `GraphNode` is not
 * assignable to its renderer or ref signatures. Rather than weaken GraphNode
 * -- which every caller relies on -- the mismatch is absorbed here, at the
 * single boundary where it exists.
 */
type SimNode = GraphNode & { x?: number; y?: number }
type GraphHandle = {
  zoomToFit: (ms: number, px: number) => void
  d3Force: (name: string) => { strength?: (v: number) => void; distance?: (v: number) => void } | undefined
}

export type GraphCategory =
  | 'security'
  | 'duplicate'
  | 'stale'
  | 'resolved'
  | 'open'

export type GraphLinkKind = 'duplicate' | 'similar' | 'reference' | 'metadata'

export interface GraphNode {
  id: string
  number: number
  title: string
  category: GraphCategory
  state: string
  labels: string[]
  engagement: number
  escalated: boolean
}

export interface GraphLink {
  source: string
  target: string
  kind: GraphLinkKind
  score: number
  why: string
}

export interface IssueGraphProps {
  nodes: GraphNode[]
  links: GraphLink[]
  onSelectIssue?: (node: GraphNode) => void
  className?: string
}

/**
 * Category colours resolved from the CSS custom properties.
 *
 * The canvas renderer needs literal colour strings -- it cannot read Tailwind
 * classes -- so the tokens are read from the document at paint time rather
 * than hardcoded. That keeps the graph on the same palette as the rest of the
 * UI without reintroducing hex literals into the source
 * (dashboard/CLAUDE.md 4).
 */
const categoryToken: Record<GraphCategory, string> = {
  security: '--critical',
  duplicate: '--information',
  stale: '--warning',
  resolved: '--accent',
  open: '--neutral',
}

const categoryLabel: Record<GraphCategory, string> = {
  security: 'Security',
  duplicate: 'Duplicate',
  stale: 'Stale',
  resolved: 'Resolved',
  open: 'Open',
}

const linkLabel: Record<GraphLinkKind, string> = {
  duplicate: 'Likely duplicate',
  similar: 'Related',
  reference: 'Explicit reference',
  metadata: 'Shared label',
}

/**
 * Resolve a design token to a literal colour for the canvas.
 *
 * No hex fallbacks: duplicating token values here would let them drift from
 * tokens.css, which is the exact problem dashboard/CLAUDE.md 4 forbids. With
 * no DOM there is nothing to paint, so `var(...)` is a harmless placeholder.
 */
function token(name: string): string {
  if (typeof window === 'undefined') {
    return `var(${name})`
  }
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim() || `var(${name})`
  )
}

const ALL_CATEGORIES: GraphCategory[] = [
  'security',
  'duplicate',
  'stale',
  'resolved',
  'open',
]

/**
 * Force-directed view of how a repository's issues relate (F15).
 *
 * The spatial layout is the information: the simulation pulls similar issues
 * together and pushes unrelated ones apart, so clusters of recurring bugs and
 * chains of duplicates become visible in a way a list cannot show.
 *
 * Colour is never the only encoding. Every node is labelled with its issue
 * number on the canvas, the legend names each category in text, and clicking
 * an edge reports the reason it exists.
 */
export function IssueGraph({
  nodes,
  links,
  onSelectIssue,
  className,
}: IssueGraphProps) {
  // Structural type rather than the library's ForceGraphMethods, which is
  // only reachable through the lazily-imported module.
  const graphRef = useRef<GraphHandle | null>(null)
  const [hidden, setHidden] = useState<Set<GraphCategory>>(new Set())
  const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null)

  // Force strengths, applied once the lazy component has mounted.
  //
  // The library's defaults are calibrated for hundreds of nodes; at eight they
  // collapse every cluster into a single knot, which hides the structure the
  // graph exists to show. Stronger repulsion and a longer link distance give
  // each cluster room to separate visibly.
  useEffect(() => {
    const handle = graphRef.current
    if (!handle?.d3Force) {
      return
    }
    handle.d3Force('charge')?.strength?.(-260)
    handle.d3Force('link')?.distance?.(70)
  })

  const data = useMemo(() => {
    const visibleNodes = nodes.filter((node) => !hidden.has(node.category))
    const ids = new Set(visibleNodes.map((node) => node.id))
    return {
      // Cloned because the force simulation mutates its input, adding x/y/vx/vy
      // to every node. Handing it props directly mutates React state in place.
      nodes: visibleNodes.map((node) => ({ ...node })),
      links: links
        .filter((link) => ids.has(link.source) && ids.has(link.target))
        .map((link) => ({ ...link })),
    }
  }, [hidden, links, nodes])

  const toggle = (category: GraphCategory) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const paintNode = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, scale: number) => {
      const node = raw as SimNode
      const x = node.x ?? 0
      const y = node.y ?? 0
      // Engagement drives size, square-rooted so one very busy issue does not
      // dwarf everything else off the canvas.
      const radius = 4 + Math.sqrt(Math.min(node.engagement, 100)) * 0.9
      const colour = token(categoryToken[node.category])

      if (node.escalated) {
        ctx.beginPath()
        ctx.arc(x, y, radius + 3, 0, 2 * Math.PI)
        ctx.strokeStyle = colour
        ctx.lineWidth = 1.2 / scale
        ctx.stroke()
      }

      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = colour
      ctx.fill()

      // The number is drawn at every zoom level. It was previously gated
      // behind `scale > 1.1`, which meant the default view rendered as bare
      // coloured dots -- exactly the "colour is the only signal" failure this
      // component's own contract forbids (dashboard/CLAUDE.md 8).
      //
      // Font size is clamped rather than scaled linearly: dividing by `scale`
      // alone makes the text illegibly small when zoomed out and absurdly
      // large when zoomed in.
      const fontSize = Math.min(14, Math.max(9, 11 / scale))
      ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = token('--text-secondary')
      ctx.fillText(`#${node.number}`, x, y + radius + 2 / scale)
    },
    [],
  )

  if (nodes.length === 0) {
    return (
      <EmptyState
        description="Index a repository's issues to see how they relate."
        icon={Network}
        title="No graph data yet"
      />
    )
  }

  return (
    <section
      aria-label="Issue relationship graph"
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Network aria-hidden="true" className="size-4 text-accent" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Issue graph
        </h2>
        <span className="text-xs text-text-muted">
          {data.nodes.length} issues · {data.links.length} connections
        </span>
        <Button
          className="ml-auto h-7 px-2 text-xs"
          onClick={() => graphRef.current?.zoomToFit(400, 40)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Fit to view
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {ALL_CATEGORIES.map((category) => {
          const off = hidden.has(category)
          const count = nodes.filter((node) => node.category === category).length
          if (count === 0) {
            return null
          }
          return (
            <Button
              aria-pressed={!off}
              className={cn('h-7 gap-1.5 px-2 text-xs', off && 'opacity-45')}
              key={category}
              onClick={() => toggle(category)}
              size="sm"
              type="button"
              variant="outline"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: `var(${categoryToken[category]})` }}
              />
              {categoryLabel[category]} {count}
            </Button>
          )
        })}
      </div>

      <div className="h-[420px] w-full overflow-hidden rounded-lg border border-border bg-background">
        <Suspense fallback={<SkeletonState className="p-4" variant="card" />}>
        <ForceGraph2D
          backgroundColor="transparent"
          // Repulsion and link distance are tuned up from the defaults, which
          // are calibrated for hundreds of nodes. At this scale the defaults
          // collapse every cluster into a knot, hiding the structure the graph
          // exists to show.
          d3AlphaDecay={0.02}
          graphData={data}
          height={420}
          linkColor={(link) =>
            token(
              (link as GraphLink).kind === 'reference'
                ? '--accent-bright'
                : '--border',
            )
          }
          linkDirectionalArrowLength={(link) =>
            (link as GraphLink).kind === 'reference' ? 3 : 0
          }
          linkLineDash={(link) =>
            (link as GraphLink).kind === 'similar' ? [3, 3] : null
          }
          linkWidth={(link) => 0.6 + (link as GraphLink).score * 2}
          nodeCanvasObject={
            paintNode as unknown as React.ComponentProps<
              typeof ForceGraph2D
            >['nodeCanvasObject']
          }
          nodeLabel={(node) =>
            `#${(node as GraphNode).number} — ${(node as GraphNode).title}`
          }
          // Frame the graph once the simulation settles. Without this the
          // default camera leaves everything clustered in a corner of a mostly
          // empty canvas -- the layout is the information, so it has to fill
          // the frame to be read at all.
          cooldownTicks={120}
          d3VelocityDecay={0.3}
          onEngineStop={() => graphRef.current?.zoomToFit(400, 60)}
          onLinkClick={(link) => setSelectedLink(link as GraphLink)}
          onNodeClick={(node) => onSelectIssue?.(node as GraphNode)}
          ref={graphRef as unknown as React.ComponentProps<typeof ForceGraph2D>['ref']}
          width={undefined}
        />
        </Suspense>
      </div>

      {selectedLink ? (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-text-secondary">
          <span className="font-medium text-text-primary">
            {linkLabel[selectedLink.kind]}
          </span>{' '}
          — {selectedLink.why}
        </p>
      ) : (
        <p className="text-xs text-text-muted">
          Click a connection to see why two issues are linked. Solid lines are
          likely duplicates, dashed are related, arrows are explicit references.
        </p>
      )}

      {/* Accessible equivalent: the canvas conveys nothing to a screen reader. */}
      <table className="sr-only">
        <caption>Issue relationships</caption>
        <thead>
          <tr>
            <th scope="col">Issue</th>
            <th scope="col">Category</th>
            <th scope="col">Connections</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.id}>
              <td>
                #{node.number} {node.title}
              </td>
              <td>{categoryLabel[node.category]}</td>
              <td>
                {links
                  .filter(
                    (link) => link.source === node.id || link.target === node.id,
                  )
                  .map((link) => link.why)
                  .join('; ') || 'none'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
