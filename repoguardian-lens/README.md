# RepoGuardian Lens

RepoGuardian Lens is a Manifest V3 Chrome/Chromium extension that brings RepoGuardian's repository memory, evidence, and agent decisions into GitHub.

> GitHub shows you what exists. RepoGuardian tells you what matters.

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

No API key is bundled. Demo mode works without network access and never writes to GitHub.

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

`MockAgentEngine` implements the provider-independent `AgentEngine` interface. A future backend adapter can replace the deterministic engine without changing UI contracts or shipping private keys in the extension.
