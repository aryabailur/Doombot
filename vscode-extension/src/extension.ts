import * as vscode from 'vscode'

import {
  createInvestigation,
  dashboardUrl,
  getHealth,
  getRegressions,
  openAutoFixPr,
  pollSeconds,
  repository,
  scanRepository,
  searchIssues,
  type AutoFixResponse,
  type RegressionFinding,
  type SearchResult,
} from './api'
import {
  EscalationsTreeProvider,
  FixPrIndex,
  InvestigationsTreeProvider,
  type InvestigationRow,
} from './trees'

let statusBarItem: vscode.StatusBarItem
let escalations: EscalationsTreeProvider
let investigations: InvestigationsTreeProvider
let fixPrs: FixPrIndex
let pollTimer: ReturnType<typeof setInterval> | undefined
let panel: vscode.WebviewPanel | undefined

/**
 * Last seen critical count, so a rise can raise a toast.
 *
 * `undefined` until the first poll completes. Seeding it to 0 meant the
 * first poll after activation treated every already-open critical escalation
 * as brand new and fired a toast for a backlog the user had already seen --
 * the contract asks for a toast when the count *rises*, and establishing the
 * baseline is not a rise.
 */
let lastCriticalCount: number | undefined

/**
 * Regression findings already toasted this session, keyed by
 * `${source_pr}:${head_sha}` -- the same fix regressing again after a later
 * commit is a genuinely new event and should toast again, but the same
 * finding coming back on every poll tick must not repeat.
 */
const announcedRegressions = new Set<string>()

/**
 * Whether the first regressions poll has completed.
 *
 * The same trap `lastCriticalCount` documents above, for a differently
 * shaped piece of state: a regression can have been detected -- or even
 * already have a draft fix PR -- before this VS Code session ever started
 * polling, so the very first response the extension sees can describe a
 * backlog the user has already seen, not a fresh event. So the first
 * successful poll only records every finding it sees into
 * `announcedRegressions`; it toasts for none of them. Establishing a
 * baseline is not an event.
 */
let regressionsBaselined = false

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  )
  statusBarItem.command = 'doombot.openDashboard'
  statusBarItem.text = '$(sync~spin) Doombot'
  statusBarItem.tooltip = 'Doombot — connecting to the API'
  statusBarItem.show()
  context.subscriptions.push(statusBarItem)

  fixPrs = new FixPrIndex()
  escalations = new EscalationsTreeProvider(fixPrs)
  investigations = new InvestigationsTreeProvider(fixPrs)

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('doombot.escalations', escalations),
    vscode.window.registerTreeDataProvider(
      'doombot.investigations',
      investigations,
    ),
    vscode.commands.registerCommand(
      'doombot.openDashboard',
      (route?: string) => openDashboard(context, route),
    ),
    // F15. Deliberately routes to the dashboard rather than rendering a
    // native graph: react-force-graph needs a canvas, and DESIGN.md 4 treats
    // reimplementing dashboard UI natively as a spec conflict.
    vscode.commands.registerCommand('doombot.openIssueGraph', () =>
      openDashboard(context, '/graph'),
    ),
    vscode.commands.registerCommand('doombot.triggerScan', triggerScan),
    vscode.commands.registerCommand('doombot.scanRepository', scanWholeRepo),
    vscode.commands.registerCommand('doombot.refreshEscalations', () =>
      refreshAll(),
    ),
    vscode.commands.registerCommand('doombot.searchIssues', () =>
      runSearch(context),
    ),
    vscode.commands.registerCommand(
      'doombot.openFixPr',
      (row?: InvestigationRow) => openFixPr(context, row),
    ),
  )

  // Re-arm on configuration change: the interval is read once when the timer
  // is created, so without this a new `doombot.pollSeconds` (or a corrected
  // apiBaseUrl) did nothing until the window was reloaded.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('doombot')) {
        return
      }
      startPolling()
      void refreshAll()
    }),
  )

  startPolling()
  void refreshAll()
}

/** (Re)starts the poll timer, replacing any existing one. */
function startPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
  }
  pollTimer = setInterval(() => void refreshAll(), pollSeconds() * 1000)
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
  // The panel is not in context.subscriptions (it is created on demand), so
  // it has to be disposed by hand or it outlives deactivation.
  panel?.dispose()
  panel = undefined
}

/**
 * One poll drives the status bar, both trees, and the toast.
 *
 * Polling REST rather than opening a second WebSocket: the webview already
 * holds a live socket via the dashboard, and two independent realtime
 * channels in one stretch feature is complexity without payoff.
 */
async function refreshAll(): Promise<void> {
  await Promise.all([escalations.refresh(), investigations.refresh()])

  // Piggybacks on the same poll rather than a second timer. Hydrates off the
  // investigations tree's summaries specifically: it is the only one of the
  // two with `decision`, `status` and `repo_name` on every row, which is what
  // `FixPrIndex.hydrate` needs both to decide what to check and to remember
  // which repo a discovered PR belongs to.
  const learnedFixPr = await fixPrs.hydrate(investigations.summaries)
  if (learnedFixPr) {
    escalations.redraw()
    investigations.redraw()
  }

  const repo = repository()
  const health = repo ? await getHealth(repo) : null
  const pending = escalations.pendingCount()

  const healthText = health ? `${Math.round(health.score)}` : '--'
  statusBarItem.text = `$(shield) Doombot ${healthText} · ${pending} open`
  statusBarItem.tooltip = new vscode.MarkdownString(
    repo
      ? `**${repo}**

${health && health.measured === false ? 'No issues to score yet' : `Health: ${healthText}/100`}

${pending} open escalation${pending === 1 ? '' : 's'}`
      : 'Set `doombot.repository` to see a health score.',
  )

  // Deliberately dumb: a rise in the critical count is the trigger, with no
  // dedup or cooldown. The contract asks for exactly this and nothing more.
  const critical = escalations.criticalCount()
  if (lastCriticalCount !== undefined && critical > lastCriticalCount) {
    const added = critical - lastCriticalCount
    void vscode.window
      .showErrorMessage(
        `Doombot: ${added} new critical escalation${added === 1 ? '' : 's'}.`,
        'Open dashboard',
      )
      .then((choice) => {
        if (choice === 'Open dashboard') {
          void vscode.commands.executeCommand(
            'doombot.openDashboard',
            '/escalations',
          )
        }
      })
  }
  lastCriticalCount = critical

  // Regression watching: wrapped in its own try/catch so a problem here --
  // an unexpected response shape, a status string this extension doesn't
  // know about -- can never stop the status bar or tree refresh above,
  // which are this extension's primary job and must keep working even if
  // this bonus notification breaks.
  try {
    if (repo.includes('/')) {
      await pollRegressions(repo)
    }
  } catch {
    // Swallowed on purpose -- see the comment above.
  }
}

/**
 * Fetches this poll's regression findings and announces anything unseen.
 *
 * Follows `getRegressions`'s null-vs-empty-array contract: `null` means the
 * request itself failed and is quietly retried next tick, while `[]` is a
 * real, good answer -- nothing regressed -- not a failure to distinguish
 * from one.
 */
async function pollRegressions(repo: string): Promise<void> {
  const findings = await getRegressions(repo)
  if (findings === null) {
    return
  }

  if (!regressionsBaselined) {
    // First successful poll: record everything already on the backend as
    // seen, and toast for none of it -- see `regressionsBaselined` above.
    for (const finding of findings) {
      announcedRegressions.add(`${finding.source_pr}:${finding.head_sha}`)
    }
    regressionsBaselined = true
    return
  }

  const unseen = findings.filter(
    (finding) =>
      !announcedRegressions.has(`${finding.source_pr}:${finding.head_sha}`),
  )
  if (unseen.length === 0) {
    return
  }
  for (const finding of unseen) {
    announcedRegressions.add(`${finding.source_pr}:${finding.head_sha}`)
  }

  // `findings` arrives newest first, so `unseen` does too. A commit that
  // reverts six fixes must not produce six modal-ish popups: past 3 unseen,
  // fold everything but the newest into that one toast's "+N more".
  if (unseen.length > 3) {
    announceRegression(repo, unseen[0], unseen.length - 1)
  } else {
    for (const finding of unseen) {
      announceRegression(repo, finding, 0)
    }
  }
}

/**
 * Shows one toast for one regression finding, branching on `status` exactly
 * as `handleAutoFixResponse` does for `AutoFixResponse` below -- each status
 * is a distinct, correct outcome the watcher reached on purpose, not a
 * success/failure pair, so severity and buttons follow from what the
 * watcher actually did, not a generic "something happened" message. A
 * button is only offered when the field it needs is non-null -- a button
 * that opens `undefined` is worse than no button.
 */
function announceRegression(
  repo: string,
  finding: RegressionFinding,
  extraCount: number,
): void {
  const suffix = extraCount > 0 ? ` (+${extraCount} more)` : ''
  const issueUrl =
    finding.issue_number !== null
      ? `https://github.com/${repo}/issues/${finding.issue_number}`
      : null

  switch (finding.status) {
    case 'fix_opened': {
      const buttons: string[] = []
      if (finding.pr_url) buttons.push('Open PR')
      if (issueUrl) buttons.push('Open issue')
      void vscode.window
        .showWarningMessage(
          `Regression in ${finding.file} — the fix from #${finding.source_pr} was undone. Draft PR #${finding.pr_number} restores it.${suffix}`,
          ...buttons,
        )
        .then((choice) => {
          if (choice === 'Open PR' && finding.pr_url) {
            void vscode.env.openExternal(vscode.Uri.parse(finding.pr_url))
          } else if (choice === 'Open issue' && issueUrl) {
            void vscode.env.openExternal(vscode.Uri.parse(issueUrl))
          }
        })
      break
    }
    case 'issue_filed': {
      // No PR exists yet -- only the issue can be offered.
      const buttons: string[] = []
      if (issueUrl) buttons.push('Open issue')
      void vscode.window
        .showWarningMessage(
          `Regression in ${finding.file} — the fix from #${finding.source_pr} was undone.${suffix}`,
          ...buttons,
        )
        .then((choice) => {
          if (choice === 'Open issue' && issueUrl) {
            void vscode.env.openExternal(vscode.Uri.parse(issueUrl))
          }
        })
      break
    }
    case 'detected':
      // Nothing was written yet -- no buttons, just the file and the
      // watcher's reason, verbatim.
      void vscode.window.showInformationMessage(
        `Regression detected in ${finding.file}: ${finding.reason}${suffix}`,
      )
      break
    case 'blocked':
      // What DEMO_MODE=1 returns, or writes being off entirely. Not a
      // failure -- reporting it as one would send someone debugging a
      // setting that is working exactly as designed.
      void vscode.window.showInformationMessage(`${finding.reason}${suffix}`)
      break
    case 'error':
      void vscode.window.showErrorMessage(`${finding.reason}${suffix}`)
      break
  }
}

/**
 * Investigates the repository's recent open issues -- the dashboard's Analyse.
 *
 * `triggerScan` asks for one issue number, which assumes the user already
 * knows which numbers exist. This is the common case: look at whatever needs
 * looking at. Returns as soon as the scan is queued; progress arrives in the
 * trees on the next poll.
 */
async function scanWholeRepo(): Promise<void> {
  const repo = repository()
  if (!repo.includes('/')) {
    void vscode.window.showWarningMessage(
      'Set `doombot.repository` to owner/repo first.',
    )
    return
  }

  const started = await scanRepository(repo)
  if (started) {
    void vscode.window.showInformationMessage(
      `Doombot is scanning ${repo} for issues to investigate.`,
    )
    await refreshAll()
  } else {
    void vscode.window.showErrorMessage(
      `Could not scan ${repo}. Is the API running, and is the name correct?`,
    )
  }
}

/** Prompts for an issue number and starts an investigation (F01). */
async function triggerScan(): Promise<void> {
  const repo = repository()
  if (!repo.includes('/')) {
    void vscode.window.showWarningMessage(
      'Set `doombot.repository` to owner/repo first.',
    )
    return
  }

  const input = await vscode.window.showInputBox({
    prompt: `Issue number to investigate in ${repo}`,
    validateInput: (value) =>
      /^\d+$/.test(value.trim()) ? null : 'Enter an issue number.',
  })
  if (!input) {
    return
  }

  const started = await createInvestigation(repo, 'issue', Number(input.trim()))
  if (started) {
    void vscode.window.showInformationMessage(
      `Doombot is investigating ${repo}#${input.trim()}.`,
    )
    await refreshAll()
  } else {
    void vscode.window.showErrorMessage(
      'Could not start the investigation. Is the API running on port 8000?',
    )
  }
}

/**
 * Opens the dashboard in a webview panel.
 *
 * The panel iframes the dashboard rather than reimplementing any of it. That
 * is the whole design: DESIGN.md 4 treats "makes the VS Code extension a
 * separate product with different logic" as a spec conflict, so the
 * extension shows the same UI C and D already built.
 */
/** A result's one-line summary: state, engagement, and the agent's verdict. */
function describeResult(result: SearchResult): string {
  const parts = [
    `${Math.round(result.score * 100)}% match`,
    result.state,
    `${result.comments} comments`,
  ]
  if (result.labels.length > 0) {
    parts.push(result.labels.slice(0, 3).join(', '))
  }
  if (result.agent?.decision) {
    const verdict = result.agent.decision.replace(/_/g, ' ')
    const confidence =
      typeof result.agent.confidence === 'number'
        ? ` ${Math.round(result.agent.confidence * 100)}%`
        : ''
    parts.push(`agent: ${verdict}${confidence}`)
  }
  return parts.join(' · ')
}

/**
 * Ask a plain-English question and pick from the answers.
 *
 * A QuickPick, not a webview, despite the feature spec asking for one. Two
 * reasons, and they point the same way:
 *
 * - DESIGN.md 4 treats reimplementing dashboard UI natively as a spec
 *   conflict, which is why `openIssueGraph` frames the dashboard rather than
 *   drawing a graph here. A hand-built HTML result list would be exactly that
 *   -- a second implementation of a view the dashboard already renders, free to
 *   drift from it.
 * - A ranked list you filter by typing and select with the keyboard is what a
 *   QuickPick already is. An iframe of the same list is slower to open, cannot
 *   be filtered, and needs the mouse.
 *
 * Selecting a result opens the investigation the agent already recorded for
 * that issue, and falls back to the issue on GitHub when there is none -- the
 * spec's "opens the investigation view" only exists for triaged issues.
 */
async function runSearch(context: vscode.ExtensionContext): Promise<void> {
  const repo = repository()
  if (!repo.includes('/')) {
    void vscode.window.showWarningMessage(
      'Set `doombot.repository` to owner/repo first.',
    )
    return
  }

  const query = await vscode.window.showInputBox({
    title: `Search ${repo}`,
    prompt: 'Ask in plain English — meaning, not keywords',
    placeHolder: 'performance complaints nobody responded to',
    ignoreFocusOut: true,
  })
  if (!query?.trim()) {
    return
  }

  const response = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Searching ${repo}…`,
      cancellable: false,
    },
    async () => {
      try {
        return await searchIssues(repo, query, 20)
      } catch (cause) {
        void vscode.window.showErrorMessage(
          `Doombot search failed: ${
            cause instanceof Error ? cause.message : 'the API is unreachable'
          }`,
        )
        return null
      }
    },
  )
  if (!response) {
    return
  }

  if (response.stats.indexed === 0) {
    void vscode.window.showInformationMessage(
      `${repo} has no indexed issues yet. Search reads the RAG index, not GitHub — run Doombot: Trigger Repository Scan first.`,
    )
    return
  }
  if (response.results.length === 0) {
    void vscode.window.showInformationMessage(
      `Nothing matched. ${response.stats.indexed} issues were searched.`,
    )
    return
  }

  const items = response.results.map((result) => ({
    label: `#${result.number} ${result.title}`,
    description: describeResult(result),
    detail: result.snippet || undefined,
    result,
  }))

  // The parsed query goes in the title, not a separate dialog. It is the one
  // piece of information that explains a surprising result set, and burying it
  // behind another interaction means nobody ever sees it.
  const readAs = response.intent.understood
    ? `read as “${response.intent.semantic_query}”`
    : 'searched literally — query understanding was unavailable'
  const dropped =
    response.stats.below_floor > 0
      ? `, ${response.stats.below_floor} too weak to show`
      : ''

  const picked = await vscode.window.showQuickPick(items, {
    title: `${response.results.length} of ${response.stats.indexed} — ${readAs}${dropped}`,
    placeHolder: 'Select an issue to open what Doombot concluded about it',
    matchOnDescription: true,
    matchOnDetail: true,
  })
  if (!picked) {
    return
  }

  const investigation = picked.result.agent?.investigation_id
  if (investigation) {
    openDashboard(context, `/investigations/${investigation}`)
    return
  }

  // Never triaged, so there is no investigation to show. Offering the issue
  // itself beats opening an empty page and calling it a result.
  const choice = await vscode.window.showInformationMessage(
    `Doombot has not investigated #${picked.result.number} yet.`,
    'Open on GitHub',
    'Investigate now',
  )
  if (choice === 'Open on GitHub') {
    void vscode.env.openExternal(
      vscode.Uri.parse(
        `https://github.com/${repo}/issues/${picked.result.number}`,
      ),
    )
  } else if (choice === 'Investigate now' && picked.result.number !== null) {
    const started = await createInvestigation(repo, 'issue', picked.result.number)
    void (started
      ? vscode.window.showInformationMessage(
          `Investigating #${picked.result.number}…`,
        )
      : vscode.window.showErrorMessage('Could not start that investigation.'))
    await refreshAll()
  }
}

/**
 * Opens (or reports on) an auto-fix PR for an investigation.
 *
 * Takes either a tree row (the right-click gesture -- the demo path: an
 * escalation or a recent investigation, both real-row classes in trees.ts
 * that carry `investigationId`) or nothing, when invoked from the command
 * palette. The palette case has no row to read an id from, so it offers a
 * picker instead of silently doing nothing.
 */
async function openFixPr(
  context: vscode.ExtensionContext,
  row?: InvestigationRow,
): Promise<void> {
  let investigationId = row?.investigationId

  if (!investigationId) {
    // Only a `resolve` investigation can plausibly have a fix to replay --
    // matches the same rule `FixPrIndex.hydrate` uses, so the picker never
    // offers something the backend would answer `no_source_pr` for on sight.
    const candidates = investigations.summaries.filter(
      (i) => i.decision === 'resolve',
    )
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(
        'No investigation has a known fix to replay yet. An auto-fix PR is only offered once an investigation resolves an issue by finding a similar, already-fixed one.',
      )
      return
    }

    const picked = await vscode.window.showQuickPick(
      candidates.map((candidate) => ({
        label: `#${candidate.number} ${candidate.title}`,
        description: candidate.repo_name,
        candidate,
      })),
      {
        title: 'Open Auto-Fix PR',
        placeHolder: 'Pick a resolved investigation',
      },
    )
    if (!picked) {
      return
    }
    investigationId = picked.candidate.investigation_id
  }

  const response = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Opening auto-fix PR…',
      cancellable: false,
    },
    async () => {
      try {
        return await openAutoFixPr(investigationId!)
      } catch (cause) {
        void vscode.window.showErrorMessage(
          `Doombot auto-fix failed: ${
            cause instanceof Error ? cause.message : 'the API is unreachable'
          }`,
        )
        return null
      }
    },
  )
  if (!response) {
    return
  }

  await handleAutoFixResponse(context, investigationId, response)
}

/**
 * Reports an `AutoFixResponse`, branching on `status` exactly as the
 * contract specifies -- each status is a distinct, correct outcome, not a
 * success/failure pair, so each gets its own message severity and action.
 */
async function handleAutoFixResponse(
  context: vscode.ExtensionContext,
  investigationId: string,
  response: AutoFixResponse,
): Promise<void> {
  switch (response.status) {
    case 'opened':
    case 'existing': {
      if (response.pr_number !== null) {
        // The repo isn't on `AutoFixResponse` itself, so it is looked up from
        // the investigations tree's own summaries rather than guessed from
        // `doombot.repository` configuration, which need not be the repo this
        // investigation belongs to. If the row isn't in the last poll's top
        // 15 (unlikely for something just acted on), the badge simply
        // catches up on the next `hydrate` instead of appearing immediately.
        const summary = investigations.summaries.find(
          (i) => i.investigation_id === investigationId,
        )
        if (summary) {
          fixPrs.record(investigationId, response.pr_number, summary.repo_name)
          escalations.redraw()
          investigations.redraw()
        }
      }
      // Say "opened" vs "already open" honestly -- reporting a pre-existing
      // PR as newly created would misrepresent what Doombot just did.
      const verb = response.status === 'opened' ? 'Opened' : 'Already open:'
      const where = response.file ? ` for ${response.file}` : ''
      const choice = await vscode.window.showInformationMessage(
        `${verb} fix PR #${response.pr_number}${where}.`,
        'Open PR',
      )
      if (choice === 'Open PR' && response.pr_url) {
        void vscode.env.openExternal(vscode.Uri.parse(response.pr_url))
      }
      break
    }
    case 'blocked':
      // What DEMO_MODE=1 returns, and what unattended auto-fix being opt-in
      // returns. Not an error -- misreporting it as one would send someone
      // debugging a setting that is working exactly as designed.
      void vscode.window.showWarningMessage(response.reason)
      break
    case 'not_applicable':
    case 'no_source_pr': {
      // The agent declining to patch is a real, correct answer, and the
      // reason is the interesting part -- shown verbatim, not paraphrased.
      const choice = await vscode.window.showInformationMessage(
        response.reason,
        'Open investigation',
      )
      if (choice === 'Open investigation') {
        openDashboard(context, `/investigations/${investigationId}`)
      }
      break
    }
    case 'error':
      void vscode.window.showErrorMessage(response.reason)
      break
  }
}

function openDashboard(
  context: vscode.ExtensionContext,
  route?: string,
): void {
  const target = `${dashboardUrl()}${route ?? '/overview'}`

  if (panel) {
    panel.reveal()
    panel.webview.html = dashboardHtml(target)
    return
  }

  panel = vscode.window.createWebviewPanel(
    'doombot.dashboard',
    'Doombot',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  )
  panel.webview.html = dashboardHtml(target)
  panel.onDidDispose(
    () => {
      panel = undefined
    },
    null,
    context.subscriptions,
  )
}

/**
 * Webview shell that frames the dashboard.
 *
 * A webview's default CSP blocks framing entirely, so `frame-src` must name
 * the dashboard origin explicitly or the panel renders blank with only a
 * console error -- the single most likely way this feature appears broken.
 * The origin comes from configuration, so it is interpolated rather than
 * hardcoded.
 */
function dashboardHtml(target: string): string {
  const origin = new URL(target).origin
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline';">
<style>
  /*
   * The shell's own background matches the dashboard's --background.
   *
   * An iframe paints nothing until it has loaded, so the panel showed VS Code's
   * default surface for the first moment and then snapped to the dashboard's
   * near-black -- a flash on every open, and on every reveal after the panel
   * had been hidden. Matching the colour here makes the load invisible.
   *
   * Hardcoded rather than read from a token: this file is the boundary between
   * two styling systems and cannot import the dashboard's CSS. It is one value,
   * and it is named here so the next person changing the palette can find it.
   */
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #131210; }
  iframe { border: 0; width: 100%; height: 100vh; display: block; }
  .fallback { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
</style>
</head>
<body>
<iframe src="${target}" title="Doombot dashboard"></iframe>
<noscript><p class="fallback">Enable scripts to view the Doombot dashboard.</p></noscript>
</body>
</html>`
}
