# RepoGuardian Lens

RepoGuardian Lens is a Manifest V3 Chrome/Chromium extension that brings RepoGuardian's repository memory, evidence, and agent decisions into GitHub.

> GitHub shows you what exists. RepoGuardian tells you what matters.

## Two modes

| | Demo repository | Live GitHub |
|---|---|---|
| Data | Deterministic seeded fixtures | Public GitHub REST API |
| Network | None required | `api.github.com` |
| Credentials | None | None (optional token raises the rate limit) |
| Retrieval | Curated evidence table | Real issues, ranked by text/subsystem/label overlap |
| Confidence | Scripted demo values | Measured similarity |

Demo mode is the default and the presentation path. Live mode reads whatever
repository you are viewing; when GitHub is unreachable or rate-limited, the
panel falls back to demo data **and says so** rather than passing seeded
results off as live ones.

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

### What live mode does not do

It reports deterministic similarity, keyword-level security and regression
signals, and computed health metrics. It does **not** perform LLM reasoning, so
confidence values are honest retrieval scores rather than model judgements. A
`backendUrl` field is reserved for a future LLM-backed engine.

## What is implemented

- GitHub repository, issue, and pull-request URL detection with SPA navigation updates
- Shadow DOM injection so GitHub styles cannot affect the Lens UI
- Deterministic offline agent engine with retrieval, ranking, decisions, and auditable events
- Repository overview, health snapshot, project memory, and repository X-ray
- Issue decisions for escalation, silence, incomplete reports, duplicates, and uncertainty
- Animated investigation trace and clickable SVG evidence graph
- Repository-history-aware PR risk context
- `Cmd/Ctrl + G` command palette and grounded Ask responses
- Approval-first demo actions, local feedback, and deterministic demo reset
- Keyboard navigation, visible focus, reduced-motion support, and resilient error/empty states
- Live GitHub mode: real issue retrieval, ranking, and evidence-backed decisions
- Agent tab: live subscription to the backend's autonomous monitoring over `/ws`
- Options page for data source, optional GitHub token, and backend origin

No API key is bundled. Demo mode works without network access, and neither mode
ever writes to GitHub — every consequential action stays a proposal until a
maintainer approves it.

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

- Permissions are limited to `storage`, `activeTab`, `scripting`, and `https://github.com/*`.
- Consequential actions are proposals until the maintainer approves or rejects them.
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

`MockAgentEngine` (seeded) and `LiveAgentEngine` (GitHub REST) both implement
the provider-independent `AgentEngine` interface, so the UI is identical in
either mode. The service worker picks one per request from stored settings and
degrades from live to seeded on failure. A future LLM-backed engine slots in
behind the same interface without changing UI contracts or shipping keys.
