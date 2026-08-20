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
type SimNode = GraphNode & { x?: number; y?: number }
type GraphHandle = {
  zoomToFit: (ms: number, px: number) => void
  d3Force: (name: string) => { strength?: (v: number) => void; distance?: (v: number) => void } | undefined
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
  if (props.codeGraph) {
    return (
      <CodeGraphExplorer
        className={props.className}
        graph={props.codeGraph}
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

function codeLinkColour(link: CodeGraphLink): string {
  if (link.edge_type === 'http_calls') {
    return token('--accent-bright')
  }
  if (link.edge_type === 'renders') {
    return token('--information')
  }
  return token('--border')
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

function GraphInspector({
  graph,
  node,
  link,
}: {
  graph: CodeGraphResponse
  node: CodeGraphNode | null
  link: CodeGraphLink | null
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
  const [dimension, setDimension] = useState<'2d' | '3d'>('3d')
  const [query, setQuery] = useState('')
  const [selectedNode, setSelectedNode] = useState<CodeGraphNode | null>(null)
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

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const nodes = normalized
      ? graph.nodes.filter((node) =>
          [node.symbol_name, node.qualname, node.file_path, node.cluster_label]
            .join(' ')
            .toLowerCase()
            .includes(normalized),
        )
      : graph.nodes
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
  }, [dimension, graph.links, graph.nodes, query])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const frame = window.setTimeout(
      () => graphRef.current?.zoomToFit(reducedMotion ? 0 : 400, 56),
      reducedMotion ? 0 : 120,
    )
    return () => window.clearTimeout(frame)
  }, [dimension, filtered.nodes.length, reducedMotion])

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
        const fontSize = Math.min(13, Math.max(8, 10 / scale))
        ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = token('--text-secondary')
        ctx.fillText(node.symbol_name, x, y + radius + 2 / scale)
      }
    },
    [graph.stats.clusters],
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
        <div className="h-[560px] min-w-0 overflow-hidden rounded-lg border border-border bg-background">
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
                  linkColor={(raw) => codeLinkColour(raw as CodeGraphLink)}
                  linkDirectionalArrowLength={(raw) =>
                    (raw as CodeGraphLink).edge_type === 'calls' ? 2 : 4
                  }
                  linkDirectionalParticles={(raw) =>
                    reducedMotion || (raw as CodeGraphLink).edge_type === 'calls'
                      ? 0
                      : 2
                  }
                  linkOpacity={0.55}
                  linkWidth={(raw) =>
                    (raw as CodeGraphLink).edge_type === 'http_calls' ? 1.5 : 0.8
                  }
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
                  onLinkClick={(raw) => selectLink(raw as MutableCodeLink)}
                  onNodeClick={(raw) => selectNode(raw as CodeGraphNode)}
                  ref={graphRef as unknown as React.ComponentProps<typeof ForceGraph3D>['ref']}
                />
              ) : (
                <ForceGraph2D
                  backgroundColor="transparent"
                  cooldownTicks={1}
                  enableNodeDrag={false}
                  graphData={filtered}
                  height={560}
                  linkColor={(raw) => codeLinkColour(raw as CodeGraphLink)}
                  linkDirectionalArrowLength={(raw) =>
                    (raw as CodeGraphLink).edge_type === 'calls' ? 2 : 4
                  }
                  linkWidth={(raw) =>
                    (raw as CodeGraphLink).edge_type === 'http_calls' ? 1.5 : 0.8
                  }
                  nodeCanvasObject={
                    paintCodeNode as unknown as React.ComponentProps<
                      typeof ForceGraph2D
                    >['nodeCanvasObject']
                  }
                  nodeLabel={(raw) => {
                    const node = raw as CodeGraphNode
                    return `${node.symbol_name} — ${node.file_path}:${node.start_line} — ${impactLabel(node)}`
                  }}
                  onLinkClick={(raw) => selectLink(raw as MutableCodeLink)}
                  onNodeClick={(raw) => selectNode(raw as CodeGraphNode)}
                  ref={graphRef as unknown as React.ComponentProps<typeof ForceGraph2D>['ref']}
                />
              )}
            </Suspense>
          )}
        </div>

        <GraphInspector graph={graph} link={selectedLink} node={selectedNode} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-muted">
        <GraphLegend label="Directly changed" tokenName="--critical" />
        <GraphLegend label="Dependency ripple" tokenName="--warning" />
        <GraphLegend label="Subsystem colour" tokenName="--accent" />
        <span>Sphere size represents dependency centrality.</span>
      </div>

      <p className="text-xs text-text-muted">
        {graph.stats.attribution}. Impact follows dependencies in both directions
        to depth two; high-degree hubs are suppressed to avoid noisy false alarms.
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
