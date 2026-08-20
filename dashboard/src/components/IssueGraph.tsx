import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Box, Code2, GitBranch, Network, RotateCcw, Search } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { SkeletonState } from '@/components/SkeletonState'
import type {
  CodeGraphEdgeType,
  CodeGraphLink,
  CodeGraphNode,
  CodeGraphResponse,
  IssueGraphCategory,
  IssueGraphLink,
  IssueGraphLinkKind,
  IssueGraphNode,
} from '@/lib/types'
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
const ForceGraph3D = lazy(() => import('react-force-graph-3d'))

/**
 * The library types graph nodes as its own loose `NodeObject` (an index
 * signature plus optional simulation coordinates), so our `GraphNode` is not
 * assignable to its renderer or ref signatures. Rather than weaken GraphNode
 * -- which every caller relies on -- the mismatch is absorbed here, at the
 * single boundary where it exists.
 */
type SimNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number }
type D3Force = {
  strength?: (v: number | ((node: SimNode) => number)) => void
  /** d3-force accepts a constant or a per-link accessor. */
  distance?: (v: number | ((link: GraphLink) => number)) => void
}
type CustomForce = {
  (alpha: number): void
  initialize?: (nodes: SimNode[]) => void
}
type GraphHandle = {
  zoomToFit: (ms: number, px: number) => void
  d3Force: (name: string, force?: CustomForce) => D3Force | undefined
}

export type GraphCategory = IssueGraphCategory
export type GraphLinkKind = IssueGraphLinkKind
export type GraphNode = IssueGraphNode
export type GraphLink = IssueGraphLink

export interface IssueGraphProps {
  nodes?: GraphNode[]
  links?: GraphLink[]
  codeGraph?: CodeGraphResponse
  onSelectIssue?: (node: GraphNode) => void
  onSelectCode?: (node: CodeGraphNode) => void
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

/** Runtimes the code graph assigns, in a stable display order. */
const RUNTIMES = ['python', 'server', 'browser', 'shared'] as const

/** Add or remove one value, returning a new Set so React sees the change. */
function toggleIn(current: Set<string>, value: string): Set<string> {
  const next = new Set(current)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
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
export function IssueGraph(props: IssueGraphProps) {
  const hasIssues = (props.nodes?.length ?? 0) > 0
  const hasCode = Boolean(props.codeGraph)

  // Default to whichever view has data, preferring issue relationships --
  // that is the F15 headline, and the code graph is the supporting view.
  const [view, setView] = useState<'issues' | 'code'>(
    hasIssues ? 'issues' : 'code',
  )

  // Previously `if (props.codeGraph)` returned early, so passing both data
  // sets rendered only the code graph and the issue-relationship view was
  // unreachable -- built, served by the API, and never seen. When both are
  // present they are now switchable rather than one silently winning.
  if (hasIssues && hasCode) {
    return (
      <div className={cn('flex flex-col gap-3', props.className)}>
        <div
          aria-label="Graph view"
          className="flex items-center gap-1 self-start rounded-lg border border-border bg-surface p-1"
          role="tablist"
        >
          <Button
            aria-selected={view === 'issues'}
            onClick={() => setView('issues')}
            role="tab"
            size="sm"
            variant={view === 'issues' ? 'secondary' : 'ghost'}
          >
            <Network aria-hidden="true" className="size-4" />
            Issue relationships
          </Button>
          <Button
            aria-selected={view === 'code'}
            onClick={() => setView('code')}
            role="tab"
            size="sm"
            variant={view === 'code' ? 'secondary' : 'ghost'}
          >
            <Code2 aria-hidden="true" className="size-4" />
            Code structure
          </Button>
        </div>

        {view === 'issues' ? (
          <IssueRelationshipGraph
            links={props.links ?? []}
            nodes={props.nodes ?? []}
            onSelectIssue={props.onSelectIssue}
          />
        ) : (
          <CodeGraphExplorer
            graph={props.codeGraph!}
            onSelectCode={props.onSelectCode}
          />
        )}
      </div>
    )
  }

  if (hasCode) {
    return (
      <CodeGraphExplorer
        className={props.className}
        graph={props.codeGraph!}
        onSelectCode={props.onSelectCode}
      />
    )
  }

  return (
    <IssueRelationshipGraph
      className={props.className}
      links={props.links ?? []}
      nodes={props.nodes ?? []}
      onSelectIssue={props.onSelectIssue}
    />
  )
}

function IssueRelationshipGraph({
  nodes,
  links,
  onSelectIssue,
  className,
}: Required<Pick<IssueGraphProps, 'nodes' | 'links'>> &
  Pick<IssueGraphProps, 'onSelectIssue' | 'className'>) {
  // Structural type rather than the library's ForceGraphMethods, which is
  // only reachable through the lazily-imported module.
  const graphRef = useRef<GraphHandle | null>(null)
  /** Node list handed to us by the simulation, for the gravity force. */
  const simNodes = useRef<SimNode[]>([])
  const [hidden, setHidden] = useState<Set<GraphCategory>>(new Set())
  const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null)

  /**
   * Hovered node, and its immediate neighbourhood.
   *
   * Obsidian's graph makes structure legible by focus rather than by drawing
   * more: hovering a note lifts it and its links and fades everything else.
   * At any real repository size that is the difference between a hairball and
   * a readable neighbourhood, and it costs one hover handler plus an opacity
   * decision in the painters.
   */
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const neighbourhood = useMemo(() => {
    if (!hoveredId) {
      return null
    }
    const ids = new Set<string>([hoveredId])
    const edges = new Set<string>()
    for (const link of links) {
      if (link.source === hoveredId || link.target === hoveredId) {
        ids.add(link.source)
        ids.add(link.target)
        edges.add(`${link.source}->${link.target}`)
      }
    }
    return { ids, edges }
  }, [hoveredId, links])

  /** Ids with at least one edge, so the layout can treat orphans differently. */
  const connectedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const link of links) {
      ids.add(link.source)
      ids.add(link.target)
    }
    return ids
  }, [links])

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

    // Unconnected nodes get no link force, so plain charge repulsion throws
    // them to the far corners of the canvas. zoomToFit then has to frame
    // those outliers, which shrinks the actual cluster to a few pixels in a
    // corner -- one orphan issue was enough to make the whole graph
    // unreadable, which is the single biggest reason it looked arbitrary.
    //
    // Repulsion is therefore scaled down for nodes with no edges, and a weak
    // centering force holds them in a loose "no relationships yet" group near
    // the middle. Connected clusters keep the strong repulsion that separates
    // them; the orphans stop dictating the viewport.
    handle.d3Force('charge')?.strength?.((node: SimNode) =>
      connectedIds.has(node.id) ? -260 : -40,
    )

    // Link distance proportional to relatedness, the way Obsidian's graph
    // spaces notes: a 0.99-similarity duplicate sits almost on top of its
    // twin, a 0.66 "related" edge sits far out. A single fixed distance --
    // what this used before -- draws a 0.99 duplicate and a 0.66 near-miss
    // exactly the same length apart, which is what made a real hierarchy of
    // relatedness look like an arbitrary scatter. Distance is now the primary
    // carrier of the similarity score, not just line thickness.
    handle.d3Force('link')?.distance?.(
      (link: GraphLink) => 30 + (1 - link.score) * 190,
    )

    // A gravity force toward the origin, applied per node.
    //
    // NOT forceCenter: despite the name it does not attract anything. It
    // computes the centroid and translates every node by the same offset, so
    // relative positions are untouched -- it can never pull an orphan toward
    // the cluster, and setting its strength below 1 only weakens that
    // recentering. Orphans stayed exiled because nothing was pulling them in.
    //
    // Written by hand rather than imported from d3-force-3d: that package is
    // a transitive dependency of react-force-graph, not one we declare, and
    // importing it directly would add an undeclared dependency (root
    // CLAUDE.md rule 10) for ~10 lines of arithmetic.
    //
    // Orphans are pulled ~4x harder so they gather near the middle instead of
    // drifting to the corners, while connected clusters stay loose enough for
    // the link forces to shape them.
    const gravity = (alpha: number) => {
      const all = simNodes.current
      // Chronological ordering, so a duplicate chain reads left-to-right as
      // "original -> later report" instead of as an undirected blob.
      //
      // This is the "flow" the scatter was missing. `similar` and `duplicate`
      // edges are symmetric, so nothing in the data implied a direction and
      // the layout had none to show. Issue number is a real ordering that is
      // always present, and nudging each node toward an x slot derived from
      // it gives the graph a consistent reading direction -- older issues to
      // the left, newer to the right -- without inventing a relationship.
      //
      // Strength 0.15, chosen by replaying this simulation across 20 random
      // starting layouts rather than by eye. At 0.035 the ordering only held
      // 3/20 times -- charge repulsion simply overwhelmed it, which is why an
      // earlier attempt at this looked no less random. At 0.25 the ordering
      // is stable but the flow overpowers the link force and a 0.99 duplicate
      // no longer sits closer than a 0.69 near-miss, losing the more
      // important signal. 0.15 is the value where both hold: 20/20 correct
      // left-to-right ordering and 20/20 duplicates-closer-than-related.
      let lowest = Infinity
      let highest = -Infinity
      for (const node of all) {
        if (node.number < lowest) lowest = node.number
        if (node.number > highest) highest = node.number
      }
      const span = Math.max(1, highest - lowest)

      for (const node of all) {
        const pull = (connectedIds.has(node.id) ? 0.02 : 0.08) * alpha
        if (node.x !== undefined) {
          node.vx = (node.vx ?? 0) - node.x * pull

          if (connectedIds.has(node.id)) {
            // Spread across a fixed width so the drift does not grow with
            // issue count; only the relative order matters.
            const slot = ((node.number - lowest) / span - 0.5) * 320
            node.vx -= (node.x - slot) * 0.15 * alpha
          }
        }
        if (node.y !== undefined) {
          node.vy = (node.vy ?? 0) - node.y * pull
        }
      }
    }
    gravity.initialize = (assigned: SimNode[]) => {
      simNodes.current = assigned
    }
    handle.d3Force('doombotGravity', gravity)
  }, [connectedIds])

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

  /** Visible nodes with no visible edge -- surfaced in the header. */
  const unconnectedCount = useMemo(() => {
    const linked = new Set<string>()
    for (const link of data.links) {
      linked.add(link.source)
      linked.add(link.target)
    }
    return data.nodes.filter((node) => !linked.has(node.id)).length
  }, [data])

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
      // dwarf everything else off the canvas. Floor of 7px: engagement is
      // legitimately 0 on most issues in a young repository, and at radius 4
      // those nodes were sub-pixel specks -- neither readable nor comfortably
      // clickable. The sqrt term still differentiates busy issues; it no
      // longer decides whether a node is visible at all.
      const radius = 7 + Math.sqrt(Math.min(node.engagement, 100)) * 1.6
      const colour = token(categoryToken[node.category])

      // Focus, the way Obsidian does it: on hover the neighbourhood keeps
      // full contrast and everything else fades back. Nothing moves and
      // nothing is hidden -- the structure around the cursor simply becomes
      // the only thing competing for attention.
      const focused = neighbourhood ? neighbourhood.ids.has(node.id) : true
      ctx.globalAlpha = focused ? 1 : 0.15

      // A soft halo under each node, brighter for the hovered one. This is
      // what stops a force graph reading as flat scattered dots: it gives
      // every node a little depth and makes the hovered one clearly lifted.
      const isHovered = node.id === hoveredId
      if (focused) {
        const glow = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * (isHovered ? 3.2 : 2.1))
        glow.addColorStop(0, colour)
        glow.addColorStop(1, 'transparent')
        ctx.globalAlpha = (focused ? 1 : 0.15) * (isHovered ? 0.4 : 0.18)
        ctx.beginPath()
        ctx.arc(x, y, radius * (isHovered ? 3.2 : 2.1), 0, 2 * Math.PI)
        ctx.fillStyle = glow
        ctx.fill()
        ctx.globalAlpha = focused ? 1 : 0.15
      }

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

      // A dark rim separates touching nodes, which is how Obsidian keeps a
      // dense cluster from fusing into one blob.
      ctx.lineWidth = 1.5 / scale
      ctx.strokeStyle = token('--surface-1')
      ctx.stroke()

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

      // Titles appear for the hovered neighbourhood, or once zoomed in far
      // enough to have room for them -- Obsidian's progressive disclosure.
      // Showing every title at every zoom is what turns a graph into noise.
      if (isHovered || (focused && neighbourhood) || scale > 1.6) {
        const title =
          node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title
        ctx.font = `${Math.min(12, Math.max(8, 9.5 / scale))}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillStyle = token('--text-muted')
        ctx.fillText(title, x, y + radius + 2 / scale + fontSize + 1 / scale)
      }

      ctx.globalAlpha = 1
    },
    [hoveredId, neighbourhood],
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
          {unconnectedCount > 0 ? (
            // Naming this explicitly matters: an isolated dot otherwise reads
            // as a rendering glitch rather than the real finding, which is
            // that the issue has no duplicate, reference, or shared-label
            // relationship to anything else in the repository.
            <span title="No duplicate, reference, or shared-label relationship to any other issue">
              {' '}
              · {unconnectedCount} unconnected
            </span>
          ) : null}
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
          // Edges fade with the focus state too, so a hovered neighbourhood
          // reads as a lit subgraph rather than a highlight over a hairball.
          linkColor={(raw) => {
            const link = raw as GraphLink
            const dim =
              neighbourhood &&
              !neighbourhood.edges.has(`${link.source}->${link.target}`)
            if (dim) {
              return token('--surface-2')
            }
            return token(
              link.kind === 'reference' ? '--accent-bright' : '--border',
            )
          }}
          linkDirectionalArrowLength={(link) =>
            (link as GraphLink).kind === 'reference' ? 3 : 0
          }
          // Particles travel along the strongest edges, and along the hovered
          // neighbourhood. This is the "flow" cue: a duplicate chain visibly
          // moves, so the eye follows the relationship instead of reading a
          // static web. Capped tightly -- particles on every edge would be
          // the noise this is meant to cut.
          linkDirectionalParticles={(raw) => {
            const link = raw as GraphLink
            if (neighbourhood) {
              return neighbourhood.edges.has(`${link.source}->${link.target}`)
                ? 3
                : 0
            }
            return link.kind === 'duplicate' ? 2 : 0
          }}
          linkDirectionalParticleSpeed={(raw) =>
            0.002 + (raw as GraphLink).score * 0.004
          }
          linkDirectionalParticleWidth={2}
          linkLineDash={(link) =>
            (link as GraphLink).kind === 'similar' ? [3, 3] : null
          }
          // Thickness still tracks the score, but distance now carries it too
          // (see the link force above), so the two reinforce each other.
          linkWidth={(raw) => {
            const link = raw as GraphLink
            const dim =
              neighbourhood &&
              !neighbourhood.edges.has(`${link.source}->${link.target}`)
            return (dim ? 0.4 : 0.9) + link.score * (dim ? 0.6 : 2.4)
          }}
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
          onNodeHover={(node) =>
            setHoveredId(node ? (node as GraphNode).id : null)
          }
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
          Hover an issue to focus its neighbourhood. Older issues sit left,
          newer right; closer together means more similar. Solid lines are
          likely duplicates, dashed are related, arrows are explicit
          references. Click a connection to see why two issues are linked.
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

type SimCodeNode = CodeGraphNode & {
  x?: number
  y?: number
  z?: number
  fx?: number
  fy?: number
  fz?: number
}

type MutableCodeLink = Omit<CodeGraphLink, 'source' | 'target'> & {
  source: string | SimCodeNode
  target: string | SimCodeNode
}

const clusterTokens = [
  '--accent',
  '--information',
  '--warning',
  '--high',
  '--neutral',
  '--success',
] as const

const riskClasses: Record<CodeGraphResponse['impact']['risk_level'], string> = {
  low: 'border-information/30 bg-information/10 text-information',
  medium: 'border-warning/30 bg-warning/10 text-warning',
  high: 'border-high/30 bg-high/10 text-high',
  critical: 'border-critical/30 bg-critical/10 text-critical',
}

const edgeLabels: Record<CodeGraphLink['edge_type'], string> = {
  calls: 'Calls',
  renders: 'Renders',
  http_calls: 'HTTP call',
}

function endpointId(endpoint: MutableCodeLink['source']): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function clusterToken(cluster: string, clusters: string[]): string {
  const index = Math.max(0, clusters.indexOf(cluster)) % clusterTokens.length
  return clusterTokens[index]
}

function codeNodeColour(node: CodeGraphNode, clusters: string[]): string {
  if (node.impact_status === 'changed') {
    return token('--critical')
  }
  if (node.impact_status === 'ripple') {
    return token('--warning')
  }
  return token(clusterToken(node.cluster_label, clusters))
}

/**
 * Link colour for the code graph.
 *
 * The default edge used `--border` (#24332a), a near-black green-grey chosen
 * for 1px dividers against a surface -- on the graph's #070a08 canvas it was
 * effectively invisible, so the dependencies the graph exists to show could
 * not be seen at all. `--text-muted` (#87958c) is the dimmest token that is
 * still legible on that background.
 *
 * `dim` fades everything outside a focused neighbourhood instead of hiding it,
 * so the surrounding structure stays as context.
 */
function codeLinkColour(link: CodeGraphLink, focus?: 'on' | 'dim'): string {
  if (focus === 'dim') {
    return token('--border')
  }
  if (link.edge_type === 'http_calls') {
    return token('--accent-bright')
  }
  if (link.edge_type === 'renders') {
    return token('--information')
  }
  return focus === 'on' ? token('--accent-bright') : token('--text-muted')
}

function impactLabel(node: CodeGraphNode): string {
  if (node.impact_status === 'changed') {
    return 'Directly changed'
  }
  if (node.impact_status === 'ripple') {
    return `Ripple distance ${node.impact_distance ?? 0}`
  }
  return 'Unaffected'
}

function GraphMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'critical' | 'warning'
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p
        className={cn(
          'font-mono text-lg font-semibold text-text-primary',
          tone === 'critical' && 'text-critical',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function GraphLegend({ label, tokenName }: { label: string; tokenName: string }) {
  const dotClass =
    tokenName === '--critical'
      ? 'bg-critical'
      : tokenName === '--warning'
        ? 'bg-warning'
        : 'bg-accent'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('size-2 rounded-full', dotClass)} />
      {label}
    </span>
  )
}

function GraphDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="break-all font-mono text-text-primary">{value}</dd>
    </div>
  )
}

/**
 * The symbols one hop from `nodeId`, in one direction, as a selectable list.
 */
function CodeNeighbourList({
  graph,
  nodeId,
  direction,
  onSelect,
}: {
  graph: CodeGraphResponse
  nodeId: string
  direction: 'incoming' | 'outgoing'
  onSelect?: (node: CodeGraphNode) => void
}) {
  const rows = graph.links
    .filter((link) =>
      direction === 'incoming' ? link.target === nodeId : link.source === nodeId,
    )
    .map((link) => {
      const otherId = direction === 'incoming' ? link.source : link.target
      return {
        edge: link.edge_type,
        node: graph.nodes.find((candidate) => candidate.id === otherId),
      }
    })
    .filter(
      (row): row is { edge: CodeGraphEdgeType; node: CodeGraphNode } =>
        row.node !== undefined,
    )

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">
        {direction === 'incoming'
          ? `Called by (${rows.length})`
          : `Depends on (${rows.length})`}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {rows.map((row) => (
          <li key={`${direction}-${row.node.id}-${row.edge}`}>
            <button
              className="flex w-full items-baseline justify-between gap-2 rounded border border-transparent px-1.5 py-1 text-left hover:border-border hover:bg-background"
              onClick={() => onSelect?.(row.node)}
              type="button"
            >
              <span className="break-all font-mono text-xs text-text-primary">
                {row.node.symbol_name}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-muted">
                {row.edge.replace('_', ' ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function GraphInspector({
  graph,
  node,
  link,
  onSelectNode,
}: {
  graph: CodeGraphResponse
  node: CodeGraphNode | null
  link: CodeGraphLink | null
  onSelectNode?: (node: CodeGraphNode) => void
}) {
  if (node) {
    return (
      <aside
        aria-live="polite"
        className="rounded-lg border border-border bg-surface-2 p-4"
      >
        <Code2 aria-hidden="true" className="mb-3 size-5 text-accent" />
        <p className="break-all font-mono text-sm font-semibold text-text-primary">
          {node.symbol_name}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-text-muted">
          {node.file_path}:{node.start_line}-{node.end_line}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <GraphDatum label="Impact" value={impactLabel(node)} />
          <GraphDatum label="Kind" value={node.kind} />
          <GraphDatum label="Subsystem" value={node.cluster_label} />
          <GraphDatum label="Language" value={node.language} />
          <GraphDatum label="Incoming" value={String(node.in_degree)} />
          <GraphDatum label="Outgoing" value={String(node.out_degree)} />
        </dl>

        {/*
          The degree counts alone tell you a symbol has six callers without
          naming one of them, which leaves the obvious next question --
          "called by what?" -- answerable only by hunting the canvas. Listing
          the actual neighbours makes the panel answer it directly, and each
          row selects that symbol so the list doubles as navigation.
        */}
        <CodeNeighbourList
          direction="incoming"
          graph={graph}
          nodeId={node.id}
          onSelect={onSelectNode}
        />
        <CodeNeighbourList
          direction="outgoing"
          graph={graph}
          nodeId={node.id}
          onSelect={onSelectNode}
        />
      </aside>
    )
  }

  if (link) {
    const source = graph.nodes.find((candidate) => candidate.id === link.source)
    const target = graph.nodes.find((candidate) => candidate.id === link.target)
    return (
      <aside
        aria-live="polite"
        className="rounded-lg border border-border bg-surface-2 p-4"
      >
        <GitBranch aria-hidden="true" className="mb-3 size-5 text-information" />
        <p className="text-xs font-semibold uppercase tracking-wide text-information">
          {edgeLabels[link.edge_type]}
        </p>
        <p className="mt-2 break-all font-mono text-xs text-text-primary">
          {source?.symbol_name ?? link.source}
          <span aria-hidden="true" className="px-1 text-text-muted">
            →
          </span>
          {target?.symbol_name ?? link.target}
        </p>
        <p className="mt-3 text-xs leading-5 text-text-secondary">{link.why}</p>
      </aside>
    )
  }

  const mostAffected = graph.impact.cluster_impact[0]
  return (
    <aside className="rounded-lg border border-border bg-surface-2 p-4">
      <Network aria-hidden="true" className="mb-3 size-5 text-accent" />
      <p className="text-sm font-semibold text-text-primary">Explore the graph</p>
      <p className="mt-2 text-xs leading-5 text-text-secondary">
        Select a symbol for file and dependency details, or a line to see why the
        relationship exists.
      </p>
      {mostAffected ? (
        <div className="mt-4 rounded-lg border border-border bg-background p-3">
          <p className="text-[11px] uppercase tracking-wide text-text-muted">
            Most affected subsystem
          </p>
          <p className="mt-1 break-all font-mono text-xs text-text-primary">
            {mostAffected.cluster}
          </p>
          <p className="mt-1 text-xs text-warning">
            {Math.round(mostAffected.impact_score * 100)}% affected
          </p>
        </div>
      ) : null}
    </aside>
  )
}

function CodeGraphExplorer({
  graph,
  onSelectCode,
  className,
}: {
  graph: CodeGraphResponse
  onSelectCode?: (node: CodeGraphNode) => void
  className?: string
}) {
  const graphRef = useRef<GraphHandle | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(800)
  const [dimension, setDimension] = useState<'2d' | '3d'>('3d')
  const [query, setQuery] = useState('')
  /**
   * Structured filters, because search alone cannot cut a hairball.
   *
   * 336 symbols and 430 dependencies rendered at once is not a graph a reader
   * can interpret -- the shape is dominated by sheer edge count and no
   * individual relationship is legible. Text search only helps when you
   * already know the symbol's name; these let you narrow by structure first
   * and then look, which is the order the question actually arrives in
   * ("what does the API layer touch?" long before "where is `chain_step`?").
   */
  const [subsystems, setSubsystems] = useState<Set<string>>(new Set())
  const [runtimes, setRuntimes] = useState<Set<string>>(new Set())
  /**
   * Hide low-connectivity leaves; 0 shows everything.
   *
   * Defaults to 2 rather than 0 deliberately. The full graph is 336 symbols
   * and 430 dependencies, which renders as a hairball where no individual
   * relationship is readable -- an unusable first impression. Measured against
   * this repository: >=1 keeps 301 nodes (barely helps, since isolated symbols
   * carry no edges anyway), >=2 keeps 191 nodes and 322 links, >=3 keeps 116
   * and 200. 2 is the conservative choice -- it drops the single-reference
   * leaves that add ink without structure, while keeping every real
   * dependency chain. The slider goes to 0 for anyone who wants everything.
   */
  const [minDegree, setMinDegree] = useState(2)
  const [selectedNode, setSelectedNode] = useState<CodeGraphNode | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedLink, setSelectedLink] = useState<CodeGraphLink | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !canvasRef.current) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      if (width > 0) {
        setCanvasWidth(width)
      }
    })
    observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const nodes = graph.nodes.filter((node) => {
      if (
        normalized &&
        ![node.symbol_name, node.qualname, node.file_path, node.cluster_label]
          .join(' ')
          .toLowerCase()
          .includes(normalized)
      ) {
        return false
      }
      // An empty set means "no restriction" rather than "hide everything" --
      // the filters start open, so the first render is still the whole graph.
      if (subsystems.size > 0 && !subsystems.has(node.cluster_label)) {
        return false
      }
      if (runtimes.size > 0 && !runtimes.has(node.runtime)) {
        return false
      }
      if (minDegree > 0 && node.in_degree + node.out_degree < minDegree) {
        return false
      }
      return true
    })
    const visibleIds = new Set(nodes.map((node) => node.id))
    const links = graph.links.filter(
      (link) => visibleIds.has(link.source) && visibleIds.has(link.target),
    )
    const scale = dimension === '3d' ? 22 : 18
    return {
      nodes: nodes.map((node) => {
        const x = (dimension === '3d' ? node.x3d : node.x2d) * scale
        const y = (dimension === '3d' ? node.y3d : node.y2d) * scale
        const z = dimension === '3d' ? node.z3d * scale : 0
        return { ...node, x, y, z, fx: x, fy: y, fz: z }
      }),
      links: links.map((link) => ({ ...link })),
    }
  }, [dimension, graph.links, graph.nodes, minDegree, query, runtimes, subsystems])

  /**
   * The focused symbol and everything one hop from it.
   *
   * Hover previews, selection pins. Both feed one neighbourhood so the graph
   * lights up the same way either way, and a selection survives the mouse
   * leaving the canvas -- otherwise the detail panel describes a node whose
   * links are no longer highlighted.
   */
  const focusId = hoveredNodeId ?? selectedNode?.id ?? null

  const focus = useMemo(() => {
    if (!focusId) {
      return null
    }
    const nodeIds = new Set<string>([focusId])
    const linkKeys = new Set<string>()
    const incoming: CodeGraphLink[] = []
    const outgoing: CodeGraphLink[] = []

    for (const link of graph.links) {
      if (link.source === focusId) {
        outgoing.push(link)
        nodeIds.add(link.target)
        linkKeys.add(`${link.source}->${link.target}`)
      } else if (link.target === focusId) {
        incoming.push(link)
        nodeIds.add(link.source)
        linkKeys.add(`${link.source}->${link.target}`)
      }
    }
    return { nodeIds, linkKeys, incoming, outgoing }
  }, [focusId, graph.links])

  /** Is this link inside the focused neighbourhood? */
  const linkFocus = useCallback(
    (link: CodeGraphLink): 'on' | 'dim' | undefined => {
      if (!focus) {
        return undefined
      }
      return focus.linkKeys.has(`${link.source}->${link.target}`) ? 'on' : 'dim'
    },
    [focus],
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const frame = window.setTimeout(
      () => graphRef.current?.zoomToFit(reducedMotion ? 0 : 400, 56),
      reducedMotion ? 0 : 120,
    )
    return () => window.clearTimeout(frame)
  }, [canvasWidth, dimension, filtered.nodes.length, reducedMotion])

  const selectNode = (node: CodeGraphNode) => {
    setSelectedNode(node)
    setSelectedLink(null)
    onSelectCode?.(node)
  }

  const selectLink = (link: MutableCodeLink) => {
    setSelectedLink({
      edge_type: link.edge_type,
      source: endpointId(link.source),
      target: endpointId(link.target),
      why: link.why,
    })
    setSelectedNode(null)
  }

  const paintCodeNode = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, scale: number) => {
      const node = raw as SimCodeNode
      const x = node.x ?? 0
      const y = node.y ?? 0
      const radius = 4 + Math.min(5, node.hub_score * 8)
      const colour = codeNodeColour(node, graph.stats.clusters)

      // Focus: the hovered or selected symbol and its direct dependencies stay
      // at full contrast, everything else fades back. Nothing is hidden, so
      // the rest of the codebase remains visible as context.
      const inFocus = focus ? focus.nodeIds.has(node.id) : true
      const isFocusRoot = node.id === focusId
      ctx.globalAlpha = inFocus ? 1 : 0.12

      // A halo under the focused symbol and its neighbours -- this is the
      // "glow" that makes a selection legible in a 336-node mesh.
      if (inFocus && focus) {
        const spread = radius * (isFocusRoot ? 4 : 2.4)
        const glow = ctx.createRadialGradient(x, y, radius * 0.4, x, y, spread)
        glow.addColorStop(0, isFocusRoot ? token('--accent-bright') : colour)
        glow.addColorStop(1, 'transparent')
        ctx.globalAlpha = isFocusRoot ? 0.55 : 0.28
        ctx.beginPath()
        ctx.arc(x, y, spread, 0, Math.PI * 2)
        ctx.fillStyle = glow
        ctx.fill()
        ctx.globalAlpha = 1
      }

      if (node.impact_status !== 'unaffected') {
        ctx.beginPath()
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2)
        ctx.strokeStyle = colour
        ctx.lineWidth = 1.5 / scale
        ctx.stroke()
      }

      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = colour
      ctx.fill()

      if (scale > 0.65 || node.impact_status !== 'unaffected') {
        // Canvas text is transformed with the graph. Inverse scaling keeps a
        // symbol label close to 11 screen pixels even when a search result is
        // zoomed in, instead of expanding it to headline size.
        const fontSize = Math.min(80, Math.max(2, 11 / scale))
        ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = isFocusRoot
          ? token('--text-primary')
          : token('--text-secondary')
        ctx.fillText(node.symbol_name, x, y + radius + 2 / scale)
      } else if (inFocus && focus) {
        // Always label the focused neighbourhood, even when zoomed out past
        // the usual label threshold -- naming what you are pointing at is the
        // whole point of the interaction.
        const fontSize = Math.min(80, Math.max(2, 11 / scale))
        ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = token('--text-secondary')
        ctx.fillText(node.symbol_name, x, y + radius + 2 / scale)
      }

      ctx.globalAlpha = 1
    },
    [focus, focusId, graph.stats.clusters],
  )

  if (graph.nodes.length === 0) {
    return (
      <EmptyState
        description="Index the repository to map symbols and their dependencies."
        icon={Code2}
        title="No code graph data yet"
      />
    )
  }

  const changedCount = graph.nodes.filter(
    (node) => node.impact_status === 'changed',
  ).length
  const rippleCount = graph.nodes.filter(
    (node) => node.impact_status === 'ripple',
  ).length

  return (
    <section
      aria-label="Repository semantic code graph"
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Box aria-hidden="true" className="size-5 text-accent" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Semantic code graph
            </h2>
            <p className="truncate font-mono text-xs text-text-muted">
              {graph.repository}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-wide',
            riskClasses[graph.impact.risk_level],
          )}
        >
          {graph.impact.risk_level} risk
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            aria-label={`Switch to ${dimension === '3d' ? '2D' : '3D'} graph`}
            onClick={() => setDimension((value) => (value === '3d' ? '2d' : '3d'))}
            size="sm"
            type="button"
            variant="outline"
          >
            {dimension === '3d' ? <Network /> : <Box />}
            {dimension === '3d' ? '2D view' : '3D view'}
          </Button>
          <Button
            onClick={() => graphRef.current?.zoomToFit(reducedMotion ? 0 : 400, 56)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcw />
            Reset view
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <GraphMetric label="Symbols" value={graph.stats.node_count} />
        <GraphMetric label="Dependencies" value={graph.stats.link_count} />
        <GraphMetric label="Subsystems" value={graph.stats.cluster_count} />
        <GraphMetric label="Changed" tone="critical" value={changedCount} />
        <GraphMetric label="Ripple" tone="warning" value={rippleCount} />
        <GraphMetric label="Languages" value={graph.stats.languages.length} />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Subsystem
          </span>
          {graph.stats.clusters.map((cluster) => {
            const on = subsystems.has(cluster)
            const count = graph.nodes.filter(
              (node) => node.cluster_label === cluster,
            ).length
            return (
              <Button
                aria-pressed={on}
                className={cn('h-7 gap-1.5 px-2 text-xs', !on && 'opacity-60')}
                key={cluster}
                onClick={() => setSubsystems(toggleIn(subsystems, cluster))}
                size="sm"
                type="button"
                variant={on ? 'secondary' : 'outline'}
              >
                {cluster}
                <span className="text-text-muted">{count}</span>
              </Button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Runtime
          </span>
          {RUNTIMES.map((runtime) => {
            const on = runtimes.has(runtime)
            const count = graph.nodes.filter(
              (node) => node.runtime === runtime,
            ).length
            if (count === 0) {
              return null
            }
            return (
              <Button
                aria-pressed={on}
                className={cn('h-7 gap-1.5 px-2 text-xs', !on && 'opacity-60')}
                key={runtime}
                onClick={() => setRuntimes(toggleIn(runtimes, runtime))}
                size="sm"
                type="button"
                variant={on ? 'secondary' : 'outline'}
              >
                {runtime}
                <span className="text-text-muted">{count}</span>
              </Button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label
            className="flex items-center gap-2 text-xs text-text-secondary"
            htmlFor="code-graph-min-degree"
          >
            <span className="font-medium uppercase tracking-wide">
              Min connections
            </span>
            <input
              className="w-32 accent-[var(--accent)]"
              id="code-graph-min-degree"
              max={12}
              min={0}
              onChange={(event) => setMinDegree(Number(event.target.value))}
              step={1}
              type="range"
              value={minDegree}
            />
            <span className="w-4 tabular-nums text-text-primary">
              {minDegree}
            </span>
          </label>

          <span className="text-xs text-text-muted">
            Showing {filtered.nodes.length} of {graph.nodes.length} symbols
            {' · '}
            {filtered.links.length} of {graph.links.length} dependencies
          </span>

          {subsystems.size > 0 || runtimes.size > 0 || minDegree > 0 ? (
            <Button
              className="ml-auto h-7 px-2 text-xs"
              onClick={() => {
                setSubsystems(new Set())
                setRuntimes(new Set())
                // Back to 0, not the default of 2: "clear" should mean
                // "show me everything", otherwise there is no way to reach
                // the unfiltered graph from the UI.
                setMinDegree(0)
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Show all
            </Button>
          ) : null}
        </div>
      </div>

      <label className="relative block max-w-xl">
        <span className="sr-only">Search symbols, files, or subsystems</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
        />
        <input
          className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search symbols, files, or subsystems"
          type="search"
          value={query}
        />
      </label>

      <div className="grid min-h-[560px] gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div
          className="h-[560px] min-w-0 overflow-hidden rounded-lg border border-border bg-background"
          ref={canvasRef}
        >
          {filtered.nodes.length === 0 ? (
            <EmptyState
              className="h-full"
              description="Try a symbol, file path, or subsystem name."
              icon={Search}
              title="No matching symbols"
            />
          ) : (
            <Suspense fallback={<SkeletonState className="p-4" variant="card" />}>
              {dimension === '3d' ? (
                <ForceGraph3D
                  backgroundColor={token('--background')}
                  cooldownTicks={1}
                  enableNodeDrag={false}
                  graphData={filtered}
                  height={560}
                  linkColor={(raw) =>
                    codeLinkColour(
                      raw as CodeGraphLink,
                      linkFocus(raw as CodeGraphLink),
                    )
                  }
                  linkDirectionalArrowLength={(raw) =>
                    (raw as CodeGraphLink).edge_type === 'calls' ? 2 : 4
                  }
                  // Particles trace the focused neighbourhood, which is what
                  // makes a selected symbol's dependencies read as flowing
                  // rather than as one more static line in the mesh.
                  linkDirectionalParticles={(raw) => {
                    if (reducedMotion) {
                      return 0
                    }
                    const state = linkFocus(raw as CodeGraphLink)
                    if (state === 'on') {
                      return 4
                    }
                    if (state === 'dim') {
                      return 0
                    }
                    return (raw as CodeGraphLink).edge_type === 'calls' ? 0 : 2
                  }}
                  linkOpacity={focus ? 0.9 : 0.7}
                  linkWidth={(raw) => {
                    const state = linkFocus(raw as CodeGraphLink)
                    if (state === 'on') {
                      return 3
                    }
                    if (state === 'dim') {
                      return 0.4
                    }
                    return (raw as CodeGraphLink).edge_type === 'http_calls'
                      ? 1.5
                      : 0.9
                  }}
                  nodeColor={(raw) =>
                    codeNodeColour(raw as CodeGraphNode, graph.stats.clusters)
                  }
                  nodeLabel={(raw) => {
                    const node = raw as CodeGraphNode
                    return `<strong>${escapeHtml(node.symbol_name)}</strong><br>${escapeHtml(node.file_path)}:${node.start_line}<br>${escapeHtml(impactLabel(node))}`
                  }}
                  nodeOpacity={0.92}
                  nodeVal={(raw) =>
                    3 + Math.min(10, (raw as CodeGraphNode).hub_score * 14)
                  }
                  onEngineStop={() =>
                    graphRef.current?.zoomToFit(reducedMotion ? 0 : 400, 56)
                  }
                  onLinkClick={(raw) => selectLink(raw as MutableCodeLink)}
                  onNodeClick={(raw) => selectNode(raw as CodeGraphNode)}
                  onNodeHover={(raw) =>
                    setHoveredNodeId(raw ? (raw as CodeGraphNode).id : null)
                  }
                  ref={graphRef as unknown as React.ComponentProps<typeof ForceGraph3D>['ref']}
                  width={canvasWidth}
                />
              ) : (
                <ForceGraph2D
                  backgroundColor="transparent"
                  cooldownTicks={1}
                  enableNodeDrag={false}
                  graphData={filtered}
                  height={560}
                  linkColor={(raw) =>
                    codeLinkColour(
                      raw as CodeGraphLink,
                      linkFocus(raw as CodeGraphLink),
                    )
                  }
                  linkDirectionalArrowLength={(raw) =>
                    (raw as CodeGraphLink).edge_type === 'calls' ? 2 : 4
                  }
                  linkDirectionalParticles={(raw) =>
                    !reducedMotion && linkFocus(raw as CodeGraphLink) === 'on'
                      ? 4
                      : 0
                  }
                  linkDirectionalParticleWidth={2.5}
                  linkWidth={(raw) => {
                    const state = linkFocus(raw as CodeGraphLink)
                    if (state === 'on') {
                      return 3
                    }
                    if (state === 'dim') {
                      return 0.4
                    }
                    return (raw as CodeGraphLink).edge_type === 'http_calls'
                      ? 1.5
                      : 0.9
                  }}
                  nodeCanvasObject={
                    paintCodeNode as unknown as React.ComponentProps<
                      typeof ForceGraph2D
                    >['nodeCanvasObject']
                  }
                  nodeLabel={(raw) => {
                    const node = raw as CodeGraphNode
                    return `${node.symbol_name} — ${node.file_path}:${node.start_line} — ${impactLabel(node)}`
                  }}
                  onEngineStop={() =>
                    graphRef.current?.zoomToFit(reducedMotion ? 0 : 400, 56)
                  }
                  onLinkClick={(raw) => selectLink(raw as MutableCodeLink)}
                  onNodeClick={(raw) => selectNode(raw as CodeGraphNode)}
                  onNodeHover={(raw) =>
                    setHoveredNodeId(raw ? (raw as CodeGraphNode).id : null)
                  }
                  ref={graphRef as unknown as React.ComponentProps<typeof ForceGraph2D>['ref']}
                  width={canvasWidth}
                />
              )}
            </Suspense>
          )}
        </div>

        <GraphInspector
          graph={graph}
          link={selectedLink}
          node={selectedNode}
          onSelectNode={selectNode}
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-muted">
        <GraphLegend label="Directly changed" tokenName="--critical" />
        <GraphLegend label="Dependency ripple" tokenName="--warning" />
        <GraphLegend label="Subsystem colour" tokenName="--accent" />
        <span>Sphere size represents dependency centrality.</span>
      </div>

      <p className="text-xs text-text-muted">
        {graph.stats.attribution} Impact follows dependencies in both directions to
        depth two; high-degree hubs are suppressed to avoid noisy false alarms.
      </p>

      <table className="sr-only">
        <caption>Repository symbols and dependencies</caption>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">File</th>
            <th scope="col">Subsystem</th>
            <th scope="col">Impact</th>
            <th scope="col">Dependencies</th>
          </tr>
        </thead>
        <tbody>
          {graph.nodes.map((node) => (
            <tr key={node.id}>
              <td>{node.qualname}</td>
              <td>
                {node.file_path}:{node.start_line}-{node.end_line}
              </td>
              <td>{node.cluster_label}</td>
              <td>{impactLabel(node)}</td>
              <td>
                {graph.links
                  .filter(
                    (link) => link.source === node.id || link.target === node.id,
                  )
                  .map((link) => `${edgeLabels[link.edge_type]}: ${link.why}`)
                  .join('; ') || 'none'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
