# RepoGuardian Lens

RepoGuardian Lens is a Manifest V3 Chrome/Chromium extension that brings RepoGuardian's repository memory, evidence, and agent decisions into GitHub.

> GitHub shows you what exists. RepoGuardian tells you what matters.

## Two modes

| | Demo repository | Live GitHub |
|---|---|---|
| Data | Deterministic seeded fixtures | GitHub REST plus backend investigations when configured |
| Network | None required | `api.github.com` and the user-approved backend origin |
| Credentials | None | Optional GitHub token; backend credentials stay on the backend |
| Retrieval | Curated evidence table | Real GitHub issues or persisted backend investigations |
| Confidence | Scripted demo values | Measured similarity or backend model confidence, explicitly labelled |

Demo mode is the default and the presentation path. Live mode reads whatever
repository you are viewing and never substitutes seeded fixtures. When GitHub
or the backend is unavailable, the panel shows an error and retry action.

Switch modes from the panel header or the options page. Options also accepts an
optional GitHub token — live mode works without one at GitHub's
60-requests/hour anonymous limit; a token raises that to 5,000. No key is ever
bundled in the extension.

### The Agent tab

With a backend configured, the Lens subscribes to its WebSocket and shows the
agent's **own** work -- the monitoring loop discovering an issue and
investigating it with nobody asking. This is the part of PS-04 that makes the
product agentic rather than a lookup tool: everything else in the panel answers
a question the user just asked; this shows what the agent did unprompted.

Enable it on the backend with `DOOMBOT_MONITOR_REPOS=owner/repo` in `.env`.
Keep `DEMO_MODE=1` unless you intend real GitHub writes -- the agent applies
labels and posts comments otherwise.

Autonomous events are buffered in `chrome.storage.session`, scoped to the
repository being viewed, and surfaced through the toolbar badge. Escalations
also create a browser notification, so the maintainer does not have to leave
the Lens open to notice important work. Opening an issue is read-only; a manual
investigation starts only from an explicit **Start investigation** action.

### Live result provenance

Without a backend, Live mode reports real GitHub data scored by the local,
deterministic retrieval engine and labels it **Live GitHub heuristic**. With a
backend configured, the attention queue comes from persisted investigations
and unresolved escalations and is labelled **Backend agent decisions**.
Seeded values are confined to Demo mode.

## What is implemented

- GitHub repository, issue, and pull-request URL detection with SPA navigation updates
- Shadow DOM injection so GitHub styles cannot affect the Lens UI
- Deterministic offline agent engine with retrieval, ranking, decisions, and auditable events
- Repository overview, health snapshot, project memory, and repository X-ray
- Decision-derived maintainer policy in Memory, calibrated per repository
- Issue decisions for escalation, silence, incomplete reports, duplicates, and uncertainty
- Animated investigation trace and clickable SVG evidence graph
- Code-aware diagnosis with clickable file/line candidates and bounded hypotheses
- Verified Fix Lab with grounded patch generation, locked-down container tests, exact receipts, and single-use maintainer review
- Repository-history-aware PR risk context
- `Cmd/Ctrl + G` command palette and grounded Ask responses
- Approval-first demo actions, local feedback, and deterministic demo reset
- Keyboard navigation, visible focus, reduced-motion support, and resilient error/empty states
- Live GitHub mode: real issue retrieval, ranking, and evidence-backed decisions
- Agent tab: live subscription to the backend's autonomous monitoring over `/ws`
- Options page for data source, optional GitHub token, and backend origin

No API key is bundled. Demo mode and direct-GitHub live mode never write to
GitHub; their consequential actions remain local proposals. A configured
RepoGuardian backend drafts exact comments and labels, but writes only
after an explicit maintainer approval. Keep `DEMO_MODE=1` until testing in a
disposable repository you control; demo mode blocks execution even after an
approval attempt.

Fix Lab is deliberately separate from those issue actions. It modifies only
files retrieved as investigation evidence, caps patch size, and runs tests in a
network-disabled read-only container. A passing candidate is shown with its
exact diff, command, exit code, duration, image, and image digest. Approving it
records the review for audit; this version does not create a branch or pull
request and never describes approval as publication.

## Install for development

```bash
cd repoguardian-lens
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `repoguardian-lens/dist`.

## Demo paths

The deterministic demo engine responds to these issue and PR numbers on any GitHub repository URL:

| Context | Demonstration |
|---|---|
| `/issues/482` | 94% authentication regression escalation, trace, evidence graph, approval |
| `/issues/476` | 88% silent decision based on historical resolution |
| `/issues/491` | Focused missing-information follow-up with approval gate |
| `/issues/495` | 94% duplicate match to canonical issue #382 |
| `/issues/498` | Honest 42% insufficient-evidence decision |
| `/pull/201` | Repository-history-aware authentication risk |

For the scripted presentation, open `https://github.com/acme/payments-api/issues/482`. The GitHub repository may not exist; the content script still runs on GitHub's page and the extension uses its offline demo repository.

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`src/background/agent/live.manual.ts` is an end-to-end check against the real
GitHub API. It is excluded from `npm test` because it needs network access and
spends the anonymous rate-limit budget. To run it:

```bash
cp src/background/agent/live.manual.ts src/background/agent/live.manual.test.ts
npx vitest run src/background/agent/live.manual.test.ts --silent=false
rm src/background/agent/live.manual.test.ts
```

## Safety model

- Required permissions are limited to `storage`, `activeTab`, `scripting`,
  `notifications`, GitHub pages, and the GitHub API.
- Backend origins are optional host permissions granted only when the user saves one.
- Demo and direct-GitHub actions are proposals until the maintainer approves or rejects them locally.
- Backend-powered investigations always require explicit approval for writes.
- Backend investigations ensure a bounded code index before mapping issues to files.
- Approval/rejection history calibrates repository policy but never enables automatic writes.
- Fix Lab never runs generated code on the host, never pulls an image during a run, and fails closed when its trusted verifier image is absent.
- Demo approvals update only `chrome.storage.local`.
- The trace exposes actions, evidence, decision factors, and outcomes—not hidden model reasoning.
- Unknown live contexts return an explicit insufficient-evidence state instead of fabricated repository intelligence.

## Architecture

```text
GitHub URL → context detector → content-script Shadow Root → React Lens
                                            ↓ messages
                                   MV3 service worker
                                            ↓
                         retrieval → ranking → decision engine
                                            ↓
                          evidence-backed structured results
```

`MockAgentEngine` (seeded), `LiveAgentEngine` (GitHub REST), and
`BackendAgentEngine` (FastAPI/LangGraph) implement the provider-independent
`AgentEngine` interface. The service worker selects exactly one from stored
settings. Live failures remain failures; they never cross into seeded data.
