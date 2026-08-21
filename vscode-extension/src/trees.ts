import * as vscode from 'vscode'

import {
  fixPrNumberFrom,
  getEscalations,
  getInvestigation,
  getInvestigations,
  type Escalation,
  type InvestigationSummary,
} from './api'

/**
 * Severity to VS Code theme icon.
 *
 * Uses the editor's own theme colours rather than the dashboard's tokens.
 * Coloured with `doombot.*` ids contributed in package.json, not with
 * `charts.*` and not with hexes.
 *
 * This used to use VS Code's generic `charts.red` / `charts.orange`, reasoning
 * that hardcoded hexes would clash with whatever theme the user runs and that
 * DESIGN.md 4 forbids a second inconsistent design system. Both points stand --
 * a contributed colour answers them rather than overriding them:
 *
 * - It is not hardcoded. Each id carries per-mode *defaults* that any theme,
 *   or the user's `workbench.colorCustomizations`, can override. Native chrome
 *   still looks native to someone running a theme that cares.
 * - It removes an inconsistency instead of adding one. The defaults are the
 *   dashboard's own palette -- light is the Calm Control Room set verbatim,
 *   dark is the derivation in dashboard/src/tokens.css -- so a critical
 *   escalation is the same red in the tree, the webview, and the browser. With
 *   `charts.red` it was three different reds for one severity.
 *
 * High contrast defers to VS Code's semantic colours, which are tuned for it.
 *
 * Every item still carries its severity as text in the label, so the icon is
 * never the only signal.
 */
function severityIcon(severity: string): vscode.ThemeIcon {
  switch (severity.toLowerCase()) {
    case 'critical':
      return new vscode.ThemeIcon(
        'error',
        new vscode.ThemeColor('doombot.critical'),
      )
    case 'high':
      return new vscode.ThemeIcon(
        'warning',
        new vscode.ThemeColor('doombot.high'),
      )
    case 'warning':
      return new vscode.ThemeIcon(
        'warning',
        new vscode.ThemeColor('doombot.warning'),
      )
    default:
      return new vscode.ThemeIcon(
        'info',
        new vscode.ThemeColor('doombot.info'),
      )
  }
}

/**
 * Investigation status to icon.
 *
 * The status values are exactly `running | done | error` -- see
 * `InvestigationSummary.status` in `api/schemas.py`. This previously matched
 * on `'completed'`, which the API never emits, so every finished
 * investigation fell through to the default and showed a spinner forever:
 * the tree claimed continuous activity while the backend was idle.
 */
function statusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'done':
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('doombot.success'))
    case 'error':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('doombot.critical'))
    case 'running':
      // The spinner keeps the accent: it is the one row that is actively
      // doing something, which is what the brand colour is for.
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('doombot.accent'))
    default:
      return new vscode.ThemeIcon('question', new vscode.ThemeColor('doombot.muted'))
  }
}

/** A leaf whose only job is to explain why the tree is empty. */
class MessageItem extends vscode.TreeItem {
  constructor(label: string, tooltip: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.tooltip = tooltip
    this.iconPath = new vscode.ThemeIcon(
      'circle-slash',
      new vscode.ThemeColor('doombot.muted'),
    )
  }
}

/**
 * Anything in either tree that carries an investigation id.
 *
 * The `doombot.openFixPr` context-menu command only receives the clicked
 * `vscode.TreeItem`, not the underlying `Escalation`/`InvestigationSummary`,
 * so both real-row classes below implement this to carry the id along.
 */
export interface InvestigationRow {
  readonly investigationId: string
}

/** What `FixPrIndex` remembers about one investigation's fix PR. */
interface FixPrEntry {
  repo: string
  pr: number
}

/**
 * Remembers which investigations have an auto-fix PR, so the badge survives
 * across polls without costing a request per row per tick.
 *
 * Backed by a plain map keyed by investigation id, with three possible
 * states per entry: absent (never checked), an entry (a known PR, with the
 * repo it belongs to), or explicitly `null` (checked, confirmed there is
 * none). That third state is the point -- see `hydrate`.
 */
export class FixPrIndex {
  private readonly cache = new Map<string, FixPrEntry | null>()

  /**
   * The known fix PR number for an investigation, or null if there isn't
   * one -- which also covers "never checked yet". Callers that need to
   * distinguish those two use `hydrate`'s return value, not this method.
   */
  known(investigationId: string): number | null {
    return this.cache.get(investigationId)?.pr ?? null
  }

  /**
   * The repo a known fix PR belongs to.
   *
   * `Escalation` carries no `repo_name` (unlike `InvestigationSummary`), so
   * the escalations tree cannot build a `github.com/{repo}/pull/{n}` URL
   * from the row alone. The repo is learned once, in `hydrate`, from the
   * investigation detail response, and stashed here alongside the PR number
   * rather than guessed from `doombot.repository` configuration -- which
   * may not even be the repo the row in question belongs to.
   */
  repoFor(investigationId: string): string | null {
    return this.cache.get(investigationId)?.repo ?? null
  }

  record(investigationId: string, prNumber: number, repo: string): void {
    this.cache.set(investigationId, { repo, pr: prNumber })
  }

  /**
   * Resolves at most `budget` not-yet-known candidates, and reports whether
   * any of them turned out to have a fix PR -- the only case that needs the
   * tree to redraw.
   *
   * Three rules, and each of them matters:
   *
   * - Only `decision === 'resolve'` AND `status === 'done'` investigations
   *   are considered. Those are the only ones that can ever have a fix PR
   *   (one is only opened once triage has already decided to replay a fix),
   *   and a finished investigation's answer will not change on its own, so
   *   it is safe to cache permanently instead of re-checking forever.
   * - A negative result -- checked, no `pr` evidence on `fix_pr_opener` -- is
   *   cached as `null`, not left unset. Without this, every poll would
   *   re-fetch the detail of every resolved investigation that happens to
   *   have no fix PR, forever, since "not yet known" and "confirmed none"
   *   would look identical to the filter below.
   * - `budget` bounds the number of detail requests fired per call. The
   *   badge appearing a poll or two late is invisible in the UI; an
   *   unbounded fan-out of one request per resolved investigation the first
   *   time a large queue loads is not.
   */
  async hydrate(candidates: InvestigationSummary[], budget = 5): Promise<boolean> {
    const pending = candidates.filter(
      (c) =>
        c.decision === 'resolve' &&
        c.status === 'done' &&
        !this.cache.has(c.investigation_id),
    )

    let learned = false
    for (const candidate of pending.slice(0, budget)) {
      const detail = await getInvestigation(candidate.investigation_id)
      if (!detail) {
        // Backend hiccup, not a verdict -- leave it unset so the next poll
        // tries again instead of caching a false negative.
        continue
      }
      const pr = fixPrNumberFrom(detail)
      if (pr !== null) {
        this.record(candidate.investigation_id, pr, candidate.repo_name)
        learned = true
      } else {
        this.cache.set(candidate.investigation_id, null)
      }
    }
    return learned
  }
}

/**
 * `· fix PR #123` appended to a row's existing description, never replacing
 * it -- the decision (or status) and the fix are both worth reading, and per
 * `dashboard/CLAUDE.md`'s never-colour-alone rule the icon must not be the
 * only signal that a fix exists.
 */
function withFixPrBadge(description: string, prNumber: number): string {
  return `${description} · fix PR #${prNumber}`
}

/** Overrides a row's click target to open the known fix PR on GitHub. */
function openPrCommand(repo: string, prNumber: number): vscode.Command {
  return {
    command: 'vscode.open',
    title: 'Open pull request',
    arguments: [vscode.Uri.parse(`https://github.com/${repo}/pull/${prNumber}`)],
  }
}

/** A real escalation row. `contextValue` is what makes the context-menu
 *  `when` clause in package.json match it, and not the `MessageItem`
 *  placeholders shown when the queue is empty or unreachable. */
class EscalationItem extends vscode.TreeItem implements InvestigationRow {
  constructor(label: string, public readonly investigationId: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.contextValue = 'doombot.escalation'
  }
}

/** A real investigation row -- see `EscalationItem` above. */
class InvestigationItem extends vscode.TreeItem implements InvestigationRow {
  constructor(label: string, public readonly investigationId: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.contextValue = 'doombot.investigation'
  }
}

export class EscalationsTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  private items: Escalation[] = []
  private reachable = true

  constructor(private readonly fixPrs: FixPrIndex) {}

  /** Critical count, so extension.ts can diff it for the toast. */
  criticalCount(): number {
    return this.items.filter((item) => item.severity.toLowerCase() === 'critical')
      .length
  }

  pendingCount(): number {
    return this.items.length
  }

  async refresh(): Promise<void> {
    const result = await getEscalations()
    this.reachable = result !== null
    this.items = result ?? []
    this.changed.fire()
  }

  /** Re-renders without refetching -- used when `FixPrIndex.hydrate` learns
   *  something new, so a badge can appear without waiting on the next poll's
   *  network round trip. */
  redraw(): void {
    this.changed.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.reachable) {
      return [
        new MessageItem(
          'Backend unreachable',
          'Start the API with: uvicorn api.main:app --reload --port 8000',
        ),
      ]
    }
    if (this.items.length === 0) {
      return [
        new MessageItem(
          'Queue is clear',
          'Doombot found nothing needing a maintainer.',
        ),
      ]
    }

    return this.items.map((escalation) => {
      const item = new EscalationItem(
        `[${escalation.severity.toUpperCase()}] #${escalation.number} ${escalation.title}`,
        escalation.investigation_id,
      )
      item.tooltip = new vscode.MarkdownString(
        `**#${escalation.number}** — ${escalation.title}\n\n` +
          `Severity: ${escalation.severity}\n\n${escalation.reason}`,
      )
      // Anything richer than this opens the dashboard: the extension is a
      // companion, and full evidence exploration belongs there (DESIGN.md 7.9).
      item.command = {
        command: 'doombot.openDashboard',
        title: 'Open in dashboard',
        arguments: [`/investigations/${escalation.investigation_id}`],
      }

      let description = escalation.reason
      const pr = this.fixPrs.known(escalation.investigation_id)
      const repo = pr !== null ? this.fixPrs.repoFor(escalation.investigation_id) : null
      if (pr !== null && repo) {
        // A known fix PR takes over the icon and the click target. The
        // severity is still readable from the label text, so the icon is
        // never the only carrier of either fact.
        item.iconPath = new vscode.ThemeIcon(
          'git-pull-request',
          new vscode.ThemeColor('doombot.success'),
        )
        description = withFixPrBadge(description, pr)
        item.command = openPrCommand(repo, pr)
      } else {
        item.iconPath = severityIcon(escalation.severity)
      }
      item.description = description
      return item
    })
  }
}

export class InvestigationsTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  private items: InvestigationSummary[] = []
  private reachable = true

  constructor(private readonly fixPrs: FixPrIndex) {}

  /**
   * The last poll's summaries, for `FixPrIndex.hydrate` to scan.
   *
   * This tree is the only one holding full `InvestigationSummary` rows
   * (decision, status, repo_name) -- `Escalation` has none of those -- so
   * `extension.ts` hydrates off this list, not the escalations tree's.
   */
  get summaries(): InvestigationSummary[] {
    return this.items
  }

  async refresh(): Promise<void> {
    const result = await getInvestigations()
    this.reachable = result !== null
    this.items = (result ?? []).slice(0, 15)
    this.changed.fire()
  }

  /** See `EscalationsTreeProvider.redraw`. */
  redraw(): void {
    this.changed.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.reachable) {
      return [
        new MessageItem('Backend unreachable', 'Start the API on port 8000.'),
      ]
    }
    if (this.items.length === 0) {
      return [
        new MessageItem(
          'No investigations yet',
          'Run Doombot: Trigger Repository Scan to start one.',
        ),
      ]
    }

    return this.items.map((investigation) => {
      const item = new InvestigationItem(
        `#${investigation.number} ${investigation.title}`,
        investigation.investigation_id,
      )
      item.iconPath = statusIcon(investigation.status)
      item.tooltip = new vscode.MarkdownString(
        `**${investigation.repo_name}#${investigation.number}**\n\n` +
          `Status: ${investigation.status}\n\n` +
          `Decision: ${investigation.decision ?? 'pending'}`,
      )
      item.command = {
        command: 'doombot.openDashboard',
        title: 'Open in dashboard',
        arguments: [`/investigations/${investigation.investigation_id}`],
      }

      let description = investigation.decision ?? investigation.status
      const pr = this.fixPrs.known(investigation.investigation_id)
      if (pr !== null) {
        item.iconPath = new vscode.ThemeIcon(
          'git-pull-request',
          new vscode.ThemeColor('doombot.success'),
        )
        description = withFixPrBadge(description, pr)
        item.command = openPrCommand(investigation.repo_name, pr)
      }
      item.description = description
      return item
    })
  }
}
