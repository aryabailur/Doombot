# PS-04 Requirements Audit - Doombot / RepoGuardian

**Audit date:** 21 August 2026
**Repository:** `aryabailur/Doombot`
**Audited commit:** `3d53ce1` (`main`)
**Official source:** `AIML.pdf`, PS-04, pages 11-13
**Purpose:** Give every teammate and their AI assistant the same evidence-backed
starting point for independently verifying what is complete, partial, missing,
or not yet demonstrated.

## Executive verdict

Doombot is a strong, demo-capable implementation of the central PS-04 idea, but
it is **not accurate to say that every requirement is complete**.

The strongest completed pieces are:

- A real multi-step LangGraph investigation.
- Semantic issue retrieval and duplicate detection using local embeddings.
- Structured evidence, confidence, live step streaming, persistence, and replay.
- Selective decisions for security, duplicates, related issues, and high impact.
- Meaningful GitHub/MCP read and write tools.
- A working API, dashboard production build, browser extension, and VS Code
  companion extension.

The most important remaining gaps are:

- No incomplete-issue or missing-information follow-up workflow.
- Monitoring watches previously unseen open issue numbers, not general repository
  activity such as updated issues, new comments, pull requests, or discussions.
- RAG indexes issue title/body data, but not the complete history requested by
  PS-04: PRs, discussions, comments, and recorded maintainer feedback.
- Health metrics do not measure actual response time, backlog growth, contributor
  activity, issue close rate, or PR merge latency.
- The approval UI records feedback but does not execute an approved action or
  persist the escalation's approved/rejected state.
- Public comments and high-confidence labels may be applied automatically before
  maintainer approval, which conflicts with `docs/DESIGN.md` section 12.
- The core live GitHub -> RAG -> Groq -> escalation -> approval -> GitHub action
  story has not been verified end to end in this audit.
- The main dashboard builds, but currently fails lint with five React errors.

**Recommended external wording:**

> The compulsory agentic workflow is substantially implemented. Some PS-04
> breadth, safety, and end-to-end demonstration requirements remain in progress.

Avoid saying "every requirement is complete" until the blockers in this report
are fixed and demonstrated.

## How to use this report

Each teammate should give this file to their own AI assistant and ask it to:

1. Inspect the current repository rather than trusting this report or the README.
2. Confirm or challenge every status with exact file and line references.
3. Run the relevant verification commands.
4. Separate source-code presence from working end-to-end behavior.
5. Report disagreements in a PR comment or shared team message.

No AI should mark an item complete only because the README says `Implemented`.

## Status legend

- **Complete:** Implemented in the relevant runtime path and supported by
  verification evidence.
- **Mostly complete:** The central behavior exists, but one meaningful part of
  the stated requirement is absent or unverified.
- **Partial:** Some code exists, but substantial requirement coverage is missing.
- **Missing:** No working implementation was found.
- **Unverified live:** Code exists, but this audit could not demonstrate the
  real external workflow with GitHub, Groq, and the embedding model.

## Official PS-04 requirements, paraphrased

The official problem statement asks for a GitHub-connected AI system that:

- Monitors repository activity.
- Learns from historical issues and maintainer decisions.
- Investigates important cases.
- Selectively escalates issues needing human attention.
- Uses repository-aware RAG.
- Uses meaningful GitHub/repository tools.
- Produces evidence-backed explanations.

The PS-04 key features additionally name:

- Access to issues, pull requests, comments, labels, and repository activity.
- Continuous monitoring that creates subtasks such as duplicate checks,
  missing-information requests, and health-trend investigations.
- Retrieval over historical issues, PRs, discussions, and maintainer decisions.
- Escalation for important, stale, duplicate, contentious, and
  security-sensitive issues.
- Health analysis for response time, backlog growth, duplicate rate,
  contributor activity, and other trends.
- Explanations linked to source issues/PRs and maintainer correction.

The official bonus features are:

- Semantic duplicate detection.
- Adaptive contributor follow-up.
- Project health forecasting.
- Approved automated GitHub actions.
- Maintainer weekly brief.
- Security-sensitive issue detection.

## Compulsory functionality audit

### 1. Autonomous repository monitoring - Partial

**Implemented evidence**

- `api/main.py` starts the monitoring service during FastAPI lifespan.
- `api/monitor.py` contains an asynchronous polling loop.
- Each scan refreshes the issue index, records a health point, fetches open
  issues, and starts investigations for previously unseen issue numbers.
- Monitoring repositories and interval are configurable with
  `DOOMBOT_MONITOR_REPOS` and `DOOMBOT_MONITOR_INTERVAL`.

**Gaps to verify**

- Monitoring is disabled when `DOOMBOT_MONITOR_REPOS` is empty.
- It calls `get_issues(..., "open", 25)` rather than monitoring general
  repository events.
- `_seen` is keyed only by `(repo_name, issue_number)`. An issue updated by a new
  comment, label, or changed description is not investigated again.
- Pull requests, discussions, repository events, and comment activity are not
  monitored by this loop.
- The issue number is added to `_seen` before the investigation runs. A failed
  run can therefore be skipped for the rest of that process lifetime.
- There is no missing-information subtask even though the module comment claims
  investigation is where such detection happens.

**Primary files**

- `api/monitor.py`
- `api/main.py`
- `.env.example`
- `api/runner.py`

### 2. Multi-step investigation - Complete for issue triage

**Implemented evidence**

The issue graph executes this ordered chain:

```text
issue_fetcher
  -> duplicate_detector
  -> resolver
  -> security_scanner
  -> impact_scorer
  -> labeler
  -> decider
```

`@chain_step` produces structured step records, evidence, timing, status, live
events, SQLite persistence, and replay.

**Qualification**

- `api/runner.py` always invokes `issue_app`, even though the request contract
  permits `kind="pr"`. PR analysis exists separately in `agents/orchestrator.py`
  and the CLI, but the API investigation path does not select it.
- The graph is linear. That is acceptable for multi-step investigation, but it
  does not dynamically create every PS-04 example subtask.

**Primary files**

- `agents/triage_graph.py`
- `agents/chain.py`
- `api/runner.py`
- `agents/orchestrator.py`

### 3. Project-aware RAG over repository history - Partial

**Implemented evidence**

- `rag/embedder.py` creates Chroma collections using local
  `all-MiniLM-L6-v2` embeddings.
- Issues are indexed as one title-and-body document per issue.
- State, labels, author, timestamps, reactions, and comment counts are metadata.
- `rag/retriever.py` performs similarity retrieval and converts Chroma L2
  distance to cosine similarity.
- Closed, labelled issues are retrieved as project-specific precedents for
  `agents/triage/labeler.py`.
- Repository source files can be separately indexed for PR review.

**Gaps to verify**

- The issue-history collection contains issue title/body data only.
- PR content, PR review discussions, issue comments, GitHub discussions,
  linked commits, and fixing PRs are not part of the issue RAG corpus.
- Recorded approve/reject/correct feedback is not used by retrieval or future
  decisions.
- "Learns from maintainer decisions" is approximated through labels on closed
  issues, not through a complete decision/feedback learning loop.
- The index is capped in different paths, so this is recent bounded history,
  not necessarily the repository's full history.

**Primary files**

- `rag/embedder.py`
- `rag/retriever.py`
- `agents/triage/duplicate_detector.py`
- `agents/triage/labeler.py`
- `api/routes_repos.py`

### 4. Selective escalation - Mostly complete

**Implemented evidence**

`agents/triage/decider.py` prioritizes:

1. Security findings.
2. A known project-specific resolution.
3. Confirmed semantic duplicates.
4. High-impact issues.
5. Related prior issues.
6. No action for low-signal cases.

Decision reasons and confidence are stored, and selected outcomes create an
escalation record.

**Gaps to verify**

- No dedicated stale-issue decision path was found.
- No contentious-discussion detection was found.
- Duplicate and related classifications exist, but explicit regression
  classification is not implemented in the issue-triage graph.
- The test suite verifies decision components, not a live pair of one escalated
  issue and one suppressed low-value issue against GitHub.

**Primary files**

- `agents/triage/decider.py`
- `agents/triage/impact_scorer.py`
- `agents/triage/security_scanner.py`
- `api/runner.py`
- `memory/repo.py`

### 5. Meaningful GitHub/repository tools - Mostly complete

**Implemented evidence**

The FastMCP server exposes GitHub tools for:

- Pull request files.
- File content.
- Pull request details.
- Pull request review comments.
- Single and bulk issue reads.
- Issue comments.
- Posting issue comments.
- Applying labels.

It also exposes seven read-only intelligence tools for search, duplicates,
escalations, health, investigations, and the issue graph.

**Gaps to verify**

- No GitHub Discussions tools were found.
- No repository activity/events tool was found.
- PR tooling and issue tooling are not unified into the monitored API workflow.
- Live permissions, rate-limit behavior, and real write behavior were not tested
  in this audit.

**Primary files**

- `mcp_server/tools.py`
- `mcp_server/github_client.py`
- `mcp_server/intelligence.py`
- `mcp_server/tool_names.py`
- `mcp_server/server.py`

### 6. Evidence-backed explanations - Complete in architecture

**Implemented evidence**

- Every decorated graph step can return structured evidence.
- Evidence supports issue, PR, file, and rule references plus snippets and scores.
- Steps are streamed over WebSocket and persisted in SQLite.
- Investigation detail replays persisted steps after refresh or restart.
- The dashboard renders evidence and confidence rather than hidden
  chain-of-thought.
- Decisions store a reason and confidence.

**Remaining demonstration need**

- Run one live investigation and verify that every important decision has a
  clickable, correct source rather than only a rule record or plain issue number.

**Primary files**

- `agents/chain.py`
- `api/runner.py`
- `memory/repo.py`
- `api/routes_investigations.py`
- `dashboard/src/components/InvestigationTrace.tsx`
- `dashboard/src/components/EvidenceCard.tsx`

## PS-04 key-feature audit

| PS-04 feature | Status | Evidence and remaining gap |
|---|---|---|
| GitHub integration | **Partial** | Issues, PR details/files, comments, and labels exist. General activity, discussions, and monitored PR changes do not. |
| Agentic repository monitoring | **Partial** | Configurable polling, indexing, health recording, and new-issue investigation exist. Updates, comments, PR activity, and missing-info subtasks do not. |
| Project-aware RAG | **Partial** | Real local embeddings and issue history retrieval exist. PRs, discussions, comments, and feedback decisions are absent from the issue corpus. |
| Selective escalation | **Mostly complete** | Security, duplicate, related, known-resolution, high-impact, and no-action paths exist. Stale, contentious, and regression paths are missing. |
| Project health analysis | **Partial** | Four scores and time-series storage exist. Required response-time, backlog-growth, close-rate, contributor, and PR-latency metrics do not. |
| Explainability and feedback | **Partial** | Evidence and feedback recording exist. Feedback does not change behavior or persist queue status, and approval does not execute an action. |

## Internal feature audit against `docs/DESIGN.md`

### P0 - Hackathon-critical

| ID | Feature | Audit status | Notes |
|---|---|---|---|
| F01 | GitHub integration and monitoring | **Partial** | Issue polling works when configured; activity coverage is narrow. |
| F02 | Multi-step investigation trace | **Complete** | Structured chain, streaming, persistence, and replay exist. Live external demo still needed. |
| F03 | Project-aware RAG | **Partial** | Historical issues are retrieved with scores; PR/history breadth is incomplete. |
| F04 | Selective escalation | **Mostly complete** | Escalate and no-action logic exist; not all named categories are handled. |
| F05 | Explainability and feedback | **Partial** | Evidence is strong; feedback is log-only and approvals do not perform actions. |
| F06 | Duplicate and regression detection | **Partial** | Semantic duplicate/related detection exists; explicit regression detection does not. |
| F13 | Web dashboard | **Mostly complete** | Production build passes, API integration exists, but lint fails and some designed screens/actions are absent or local-only. |

### P1 - Strong differentiators

| ID | Feature | Audit status | Notes |
|---|---|---|---|
| F07 | Security-sensitive detection | **Mostly complete** | Deterministic scan and LLM confirmation code exist. Only layer 1 was tested offline; live confirmation is unverified. |
| F08 | Approval-controlled auto-labeling | **Conflicts with design** | Labels at or above confidence `0.85` may be auto-applied without an explicit repository policy enabling it. |
| F09 | Incomplete-issue follow-up | **Missing** | No exact missing-field detection or focused follow-up draft was found. README also marks it planned. |
| F10 | Project-health analysis | **Partial** | Component scores and stored history exist, but the required measurements and weighting model are incomplete. |

### P2 - Bonus/stretch scope

| ID | Feature | Audit status | Notes |
|---|---|---|---|
| F11 | Weekly brief | **Partial** | On-demand count-based Markdown exists. It is not scheduled and omits several required brief sections. |
| F12 | MCP protocol server | **Complete** | Nine GitHub tools plus seven read-only intelligence tools are registered; tests cover registration and read-only safety. |
| F14 | VS Code extension | **Mostly complete** | Compiles and provides commands/tree views. A live API-connected experience was not demonstrated here. |

## Bonus-feature audit from the official PS-04 PDF

| Bonus feature | Status | Notes |
|---|---|---|
| Semantic duplicate detection | **Complete in code** | MiniLM embeddings, Chroma retrieval, cosine conversion, thresholds, self-exclusion, and evidence are implemented. Full model/index run was not performed in this audit. |
| Adaptive contributor follow-up | **Missing** | F09 is not built. |
| Project health forecasting | **Missing** | Historical score display exists, but there is no forecasting model or prediction. |
| Automated GitHub actions after approval | **Partial / unsafe mismatch** | Write tools exist, but the dashboard approval does not trigger them. Some comments and high-confidence labels can instead be written before approval. |
| Maintainer weekly brief | **Partial** | On-demand aggregate brief exists; nothing generates it weekly. |
| Security-sensitive issue detection | **Mostly complete** | Two-layer code exists and details are kept out of public security comments, but live LLM behavior was not verified. |

## Approval and safety findings requiring immediate verification

This is the highest-risk area of the current implementation.

`docs/DESIGN.md` section 12 says:

- Applying a label requires approval unless explicitly configured.
- Publishing a public comment requires approval unless explicitly configured.
- Closing an issue is prohibited by default.
- Publishing a security finding is prohibited.

The current implementation appears to behave differently:

1. `agents/triage/labeler.py` treats confidence `>= 0.85` as sufficient for
   auto-application. A confidence threshold is not the same as a repository
   policy explicitly enabling automatic labels.
2. `agents/triage/decider.py` calls GitHub write tools whenever a comment or
   auto-eligible label exists and `DEMO_MODE` is not `1`.
3. Duplicate, related, and escalation comments can therefore be published
   during investigation before the dashboard approval flow.
4. The dashboard Approve/Reject/Correct buttons call only `POST /api/feedback`.
5. `POST /api/feedback` stores the verdict but does not resolve the escalation,
   execute the proposed action, or alter future agent behavior.
6. `dashboard/src/App.tsx` updates the local displayed status in a `finally`
   block, even when posting feedback fails. The UI may therefore show an action
   as approved or rejected when the backend did not record it.

Before a live demo, decide and implement one coherent policy:

```text
investigate automatically
  -> draft recommendation and proposed GitHub action
  -> persist pending approval
  -> maintainer approves/rejects/corrects
  -> backend performs only the approved action
  -> persist action result and approver identity
```

If the team intentionally wants confidence-based automatic writes, that must be
an explicit repository policy and the design/README/demo wording must agree.

## Project-health audit details

The current score has four components:

- `responsiveness`: percentage of open issues with at least one comment.
- `staleness`: inverse score based on median age of open issues.
- `duplication`: penalty based on duplicate investigation decisions.
- `security`: penalty based on unresolved critical escalations.

These are useful prototype signals, but they are not the exact metrics named by
PS-04 or `docs/DESIGN.md`.

Missing or substituted metrics:

| Required metric | Current state |
|---|---|
| First-response time | Replaced by "has any comment" percentage. |
| Backlog growth rate | Replaced by median age/staleness. |
| Issue close rate | Missing. |
| Duplicate rate | Implemented approximately from investigation decisions. |
| Contributor activity | Missing. |
| PR merge latency | Missing. |
| Forecasting | Missing. |

The history table can display a trend only after repeated monitoring cycles.
That does not by itself implement forecasting.

## Verification performed during this audit

### Repository state

```text
Branch: main
HEAD: 3d53ce1 merge: F17 adaptive repository learning
Working tree after audit: clean
```

### Backend offline tests

Command:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```

Observed result:

```text
40 passed, 9 skipped, 1 warning in 13.17s
```

The skipped tests required a running API or live activity.

### API contract tests with local FastAPI server

Commands:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --port 8000
.\.venv\Scripts\python.exe -m pytest tests/test_api_contract.py -q
```

Observed result:

```text
7 passed, 3 skipped in 24.58s
```

The remaining skips were due to having no stored investigations/repositories or
no live WebSocket investigation events.

The server warned that `GITHUB_TOKEN` and `GROQ_API_KEY` were absent, so this was
an API-contract test, not a live agent demonstration.

### Python syntax compilation

Command:

```powershell
python -m compileall -q agents api memory mcp_server rag tests
```

Observed result: passed with no output.

### Dashboard production build

Command:

```powershell
cd dashboard
npm run build
```

Observed result: passed. Vite transformed 3,435 modules and produced the
production bundle. It warned that some chunks exceed 500 kB.

### Dashboard lint

Command:

```powershell
cd dashboard
npm run lint
```

Observed result: failed with five errors:

- `src/App.tsx`: manual memoization dependencies could not be preserved.
- `src/components/OnboardingPipeline.tsx`: synchronous state update in effect.
- `src/components/RepositorySelector.tsx`: non-component export conflicts with
  Fast Refresh rule.
- `src/lib/useApiData.ts`: ref mutation during render.
- `src/lib/useApiData.ts`: synchronous load/state update from effect.

### RepoGuardian Lens browser extension

Commands and results:

```text
npm run test  -> 9 test files passed, 53 tests passed
npm run build -> passed
npm run lint  -> passed
```

### VS Code extension

Command and result:

```text
npm run compile -> passed
```

### Dependency-install qualification

A full `pip install -r requirements.txt` was attempted in a clean local virtual
environment and failed during package download with a hash mismatch. A smaller
clean dependency set was then installed to run the offline and API-contract
tests above.

Consequently, this audit did **not** demonstrate:

- Loading the real MiniLM model.
- Building/querying a real Chroma index.
- Calling Groq.
- Reading or writing a real GitHub repository.
- A complete live autonomous monitoring cycle.

## Required end-to-end acceptance demonstration

Before the team calls PS-04 complete, record or perform this exact flow against a
safe test repository:

```text
1. Start API with a test GitHub token, Groq key, monitor repository, and safe
   approval policy.
2. Create a new issue containing a known duplicate scenario.
3. Show the monitor detecting it without a manual Scan click.
4. Show the issue and historical corpus being indexed.
5. Show all investigation steps streaming live.
6. Open the retrieved source issue and verify the similarity evidence.
7. Show an evidence-backed duplicate/escalation recommendation.
8. Confirm no public GitHub write happens before approval.
9. Approve the proposed action in the dashboard.
10. Show the backend performing exactly that action on GitHub.
11. Refresh the dashboard and prove the approval/action state persisted.
12. Create a low-value issue and prove it is suppressed.
13. Create an incomplete issue and prove exact missing fields are detected and a
    focused follow-up is drafted.
14. Show a health point and historical trend based on real measurements.
```

If any step requires a manual workaround, document it rather than presenting it
as autonomous behavior.

## Recommended fix order

### Blockers before claiming compulsory completion

1. Implement real pending-action and approval execution endpoints.
2. Stop public comments/labels before approval unless an explicit repository
   policy enables them.
3. Implement F09 missing-information detection and a focused follow-up draft.
4. Monitor issue updates/comments and PR activity, not only unseen issue numbers.
5. Demonstrate the P0 end-to-end flow with real or safely simulated events.

### Next-highest PS-04 coverage

6. Expand the history corpus to PRs, comments/discussions, linked fixes, and
   maintainer feedback.
7. Add explicit regression classification.
8. Implement the required health metrics with transparent weighting.
9. Persist escalation approval status, action result, and approver identity.
10. Fix the five dashboard lint errors and add monitoring/approval/health tests.

### Bonus completion

11. Add project-health forecasting only after real health metrics exist.
12. Schedule and persist the weekly brief.
13. Use feedback to calibrate thresholds or retrieve prior corrections.

## Teammate verification assignments

These can be split by existing stream ownership.

### Stream A - Core, API, memory, MCP client

Verify:

- Monitor lifecycle and failure/retry behavior.
- Approval/rejection/correction persistence.
- Whether any endpoint executes an approved GitHub action.
- Health calculations against exact PS-04 metrics.
- Weekly brief completeness and scheduling.
- API contract and WebSocket behavior with real stored data.

Suggested files:

- `api/main.py`
- `api/monitor.py`
- `api/runner.py`
- `api/health.py`
- `api/routes_feedback.py`
- `api/routes_investigations.py`
- `api/routes_repos.py`
- `memory/db.py`
- `memory/repo.py`

### Stream B - Agents, RAG, GitHub tools

Verify:

- Whether incomplete-issue detection exists anywhere.
- Whether regression is an actual classification.
- What data is embedded and retrieved.
- Whether PRs, comments, discussions, and feedback enter the RAG corpus.
- Security false-positive handling and live LLM confirmation.
- Every condition that can trigger a real GitHub write.
- Whether the label confidence threshold violates the approval policy.

Suggested files:

- `agents/triage_graph.py`
- `agents/triage/*.py`
- `agents/orchestrator.py`
- `rag/embedder.py`
- `rag/retriever.py`
- `mcp_server/github_client.py`
- `mcp_server/tools.py`

### Stream C - Frontend investigation and evidence

Verify:

- Evidence links are clickable and resolve to the correct GitHub source.
- Similar-issue comparison contains the required fields.
- Investigation statuses show running, complete, failed, and skipped states.
- Refresh/reconnect replays the same chain correctly.
- Partial/error/RAG-unavailable states are honest and usable.

Suggested files:

- `dashboard/src/lib/api.ts`
- `dashboard/src/lib/types.ts`
- `dashboard/src/components/EvidenceCard.tsx`
- `dashboard/src/components/InvestigationTrace.tsx`
- `dashboard/src/components/InvestigationStep.tsx`

### Stream D - Dashboard shell, escalations, health, extensions

Verify:

- Approve/Reject/Correct buttons persist and trigger intended backend behavior.
- Failed feedback requests never display a false successful status.
- Escalation filters and queue state meet the design contract.
- Health UI labels do not overstate proxy metrics as real response time/growth.
- Missing designed screens/routes are documented honestly.
- Dashboard lint errors and large bundle warning.
- VS Code and browser extensions work against the live API.

Suggested files:

- `dashboard/src/App.tsx`
- `dashboard/src/components/EscalationPreview.tsx`
- `dashboard/src/components/EscalationTable.tsx`
- `dashboard/src/components/Health*.tsx`
- `vscode-extension/src/*.ts`
- `repoguardian-lens/src/**`

## Copy-paste prompt for another AI assistant

```markdown
You are independently auditing the current Doombot/RepoGuardian repository for
Codeissance 2026 PS-04 compliance.

Read these files first:

1. AGENTS.md
2. CLAUDE.md
3. docs/DESIGN.md
4. docs/PS04_REQUIREMENTS_AUDIT.md

Do not trust README status labels or the audit file without checking the code.
Treat the official PS-04 problem statement as the highest product requirement.

Your task:

1. Inspect the current main branch and report its commit hash.
2. Verify every claim assigned to my workstream in
   docs/PS04_REQUIREMENTS_AUDIT.md.
3. For each requirement, return Complete, Mostly complete, Partial, Missing, or
   Unverified live.
4. Cite exact file paths and line numbers for every conclusion.
5. Distinguish code presence from end-to-end demonstrated behavior.
6. Identify any unsafe GitHub write that can occur before maintainer approval.
7. Run the relevant tests/build/lint commands and paste the exact results.
8. List any disagreement with the audit and explain the evidence.
9. Recommend only the smallest changes needed for PS-04 compliance.
10. Do not edit code unless I explicitly ask after reviewing your findings.

Return sections:

- Executive verdict
- Requirement-by-requirement findings
- Safety and approval findings
- Verification output
- Disagreements with the existing audit
- Required fixes in priority order
- Live-demo steps still unproven
```

## Final completion checklist

Do not mark the project fully complete until all applicable items are checked:

- [ ] A repository event automatically starts an investigation.
- [ ] Updated issues/comments and PR activity are handled according to policy.
- [ ] A real multi-step investigation streams and replays after refresh.
- [ ] RAG retrieves project-specific history with working source links.
- [ ] Historical issues and relevant PR/decision context are covered.
- [ ] A duplicate is detected semantically and self-matches are excluded.
- [ ] A regression can be distinguished from a duplicate/related issue.
- [ ] An incomplete report produces exact missing fields and a focused follow-up.
- [ ] A security issue is flagged privately.
- [ ] A low-value issue is demonstrably suppressed.
- [ ] Health shows real required metrics and at least one historical trend.
- [ ] Feedback persists and can be replayed after refresh.
- [ ] No public write occurs before approval unless explicitly configured.
- [ ] Approval performs exactly one auditable GitHub action.
- [ ] Rejection/correction prevents or changes the proposed action.
- [ ] The dashboard build and lint both pass.
- [ ] Backend unit and API-contract tests pass without unexplained skips.
- [ ] The browser extension tests/build/lint pass.
- [ ] The VS Code extension compiles and works against the live API.
- [ ] One complete live demo has been rehearsed and recorded.
- [ ] README statuses match what was actually demonstrated.

## Bottom line

The repository contains substantial, thoughtful engineering and already shows
the core value of an explainable agentic maintainer assistant. The remaining
work is less about adding flashy features and more about closing four credibility
gaps: **activity coverage, complete repository-history grounding, real human
approval, and a reproducible end-to-end demonstration**.

Those gaps should be fixed before the team tells judges that every PS-04
requirement is complete.
