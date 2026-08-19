# RepoGuardian Design and Scope Specification

> Working product name: **RepoGuardian**  
> Optional presentation identity: **DoomForge**  
> Project: Codeissance 2026 - PS-04  
> Document status: Design source of truth  
> Prepared with research and synthesis assistance from **OpenAI Codex** on 20 August 2026

---

## 1. Purpose of this document

This document is the shared design and scope contract for RepoGuardian. It is intended for:

- Team members designing or implementing the product.
- AI assistants generating future implementation prompts.
- Reviewers checking whether a proposed feature matches PS-04.
- Hackathon judges evaluating the product's design logic.

Every future implementation prompt should be checked against this document before development begins. The purpose is to prevent feature drift, inconsistent screens, unsafe automation, duplicated work, and features that cannot be demonstrated during the hackathon.

This file describes the intended product. It does not prove that a feature is implemented. The project README or implementation-status document must separately label features as `Implemented`, `In progress`, `Planned`, or `Stretch`.

### Document precedence

When instructions conflict, use this order:

1. The team's latest explicit decision.
2. The official PS-04 problem statement.
3. The final approved feature specification.
4. This design and scope specification.
5. Individual implementation prompts and aesthetic preferences.

An AI assistant must flag a conflict instead of silently changing the product scope.

---

## 2. Product definition

RepoGuardian is an agentic open-source maintainer assistant that monitors repository activity, investigates issues using project-specific history, selectively escalates important cases, and explains every recommendation with evidence.

### Core promise

> RepoGuardian investigates repository activity automatically and interrupts maintainers only when human attention is justified.

### Primary users

- Open-source maintainers
- Repository administrators
- Security maintainers
- Core contributors and reviewers

### Primary user problem

Maintainers have limited time and cannot manually investigate every issue, pull request, duplicate report, incomplete bug report, security concern, or project-health change.

### Product principles

1. **Evidence before automation** - Recommendations link to repository evidence.
2. **Selective interruption** - The product reduces noise instead of creating more notifications.
3. **Responsible autonomy** - Investigation can be automatic; consequential writes use policies and approval gates.
4. **Project-specific intelligence** - Repository history is preferred over generic advice.
5. **Visible investigation** - Users can inspect tools used, retrieved evidence, classifications, and outcomes.
6. **Human correction** - Maintainers can approve, reject, or correct decisions.
7. **Minimum necessary access** - GitHub permissions and exposed data are kept as narrow as possible.

---

## 3. Approved feature scope

The following 14 features define the approved product boundary.

| ID | Feature | Priority | Required demonstration |
|---|---|---:|---|
| F01 | GitHub integration and agentic repository monitoring | P0 | Receive a real or simulated repository event and start an investigation automatically |
| F02 | Multi-step investigation trace | P0 | Display completed, active, failed, and skipped investigation steps |
| F03 | Project-aware RAG | P0 | Retrieve relevant historical issues or PRs with source links |
| F04 | Selective escalation | P0 | Escalate an important case and suppress a low-value case |
| F05 | Explainability and maintainer feedback | P0 | Show evidence and record approve/reject/correct feedback |
| F06 | Semantic duplicate and regression detection | P0 | Compare a new issue with historical issues and explain the relationship |
| F07 | Security-sensitive issue detection | P1 | Privately flag a prepared security-sensitive issue |
| F08 | Approval-controlled auto-labeling | P1 | Suggest or apply a label according to configured confidence policy |
| F09 | Incomplete-issue follow-up | P1 | Identify exact missing fields and prepare a focused response |
| F10 | Project-health analysis | P1 | Show metric components and at least one historical trend |
| F11 | Maintainer weekly brief | P2 | Generate a concise evidence-backed summary from aggregated metrics |
| F12 | MCP protocol server | P2 | Expose a small, working set of repository-intelligence tools |
| F13 | Web dashboard | P0 | Provide the primary complete product experience |
| F14 | VS Code extension | P2 | Provide a minimal companion experience, not a duplicate full application |

### P0: hackathon-critical

The minimum credible end-to-end product is F01-F06 plus F13. If time is limited, finish and polish these before implementing additional features.

### P1: strong differentiators

F07-F10 should be added only after the complete P0 demonstration works reliably.

### P2: stretch scope

F11, F12, and F14 are useful bonuses. They must not delay the primary dashboard or break the core investigation flow.

### Explicitly outside the current MVP

The following are outside the current hackathon MVP unless the team explicitly promotes them:

- Autonomous bug execution or unrestricted Docker sandboxing
- Automatic code modification and merge
- Full AST blast-radius analysis across multiple languages
- Reviewer matchmaking and workload balancing
- Contributor reputation scoring
- Toxicity or personality scoring
- Documentation PR generation
- Flaky-test root-cause isolation
- Cross-organization analytics
- A full-featured terminal CLI

An AI assistant may recommend these as roadmap items, but must not insert them into an MVP implementation prompt without approval.

---

## 4. Scope-checking protocol for AI assistants

Before generating an implementation prompt, the assisting AI must produce a scope check.

### Required scope-check output

```markdown
## Scope verdict

- Verdict: In scope | In scope with constraints | Stretch | Out of scope | Conflicts with specification
- Feature IDs: F__
- Target user flow:
- Target screen or service:
- Why it belongs:
- Dependencies:
- Safety or approval requirements:
- Data required:
- Explicit non-goals:
```

### Scope decision rules

A request is **in scope** when it directly implements or supports an approved feature and fits its priority.

A request is **in scope with constraints** when the goal is valid but the proposed implementation would violate safety, privacy, terminology, or visual consistency.

A request is **stretch** when it corresponds to a P2 feature or an approved roadmap extension.

A request is **out of scope** when it does not improve monitoring, investigation, repository-aware retrieval, escalation, explainability, health, or an approved interface.

A request **conflicts with the specification** when it:

- Exposes hidden model chain-of-thought.
- Publishes suspected vulnerabilities publicly by default.
- Performs destructive GitHub actions without approval.
- Claims generic LLM output is project-aware RAG without retrieval evidence.
- Adds a second inconsistent design system.
- Makes the VS Code extension a separate product with different logic.
- Treats a planned feature as implemented.

### Required implementation-prompt sections

Every generated implementation prompt should contain:

1. Scope verdict and mapped feature IDs
2. User outcome
3. Existing components to reuse
4. Functional requirements
5. Data and API contract assumptions
6. UI states and error states
7. Security and approval requirements
8. Accessibility requirements
9. Acceptance criteria
10. Explicit non-goals
11. Verification steps

---

## 5. Primary demonstration story

The product must support this coherent demo:

```text
GitHub issue event arrives
  -> RepoGuardian creates an investigation
  -> Project history is searched through RAG
  -> Similar issues and linked fixes are compared
  -> The report is classified as duplicate, regression, related, or novel
  -> Completeness and security signals are assessed
  -> An evidence-backed escalation decision is generated
  -> A maintainer approves, rejects, or corrects the recommendation
  -> The approved GitHub action is performed
  -> Feedback and health metrics are updated
```

The visual design should always make these three questions easy to answer:

1. What happened?
2. Why did the agent make this recommendation?
3. What action requires the maintainer's attention?

---

## 6. Information architecture

### Primary navigation

```text
Overview
Escalations
Investigations
Repository History
Project Health
Weekly Brief
Policies
Settings
```

### Persistent application chrome

- Collapsible left sidebar
- Repository selector
- Global search or command menu
- Agent connection state
- GitHub connection state
- Last successful synchronization time
- User/profile menu

### Recommended routes

```text
/
/overview
/escalations
/investigations
/investigations/:id
/history
/health
/briefs
/policies
/settings
```

---

## 7. Screen specifications

### 7.1 Overview dashboard

Purpose: answer "What needs attention right now?"

Required content:

- Repository selector and sync status
- Project-health score with component breakdown
- Open escalation counts by severity
- Pending approval count
- Agent activity feed
- Health trend chart
- Highest-priority escalation list
- Last scan and next reconciliation time

Recommended layout:

```text
+-------------------------------------------------------------+
| Repository             Last sync            Agent: Active   |
+------------+------------+------------+----------------------+
| Health 84  | Critical 3 | Pending 12 | Response time -18%   |
+-------------------------+-----------------------------------+
| Project health trend    | Agent activity                    |
|                         | Investigated #142                 |
|       chart             | Found regression #97             |
|                         | Waiting for approval              |
+-------------------------+-----------------------------------+
| Important escalations                                       |
+-------------------------------------------------------------+
```

Do not rely on the overall health score alone. Always reveal metric components and weightings.

### 7.2 Escalation queue

Purpose: provide a fast, low-noise maintainer inbox.

Required functionality:

- Filter by severity, category, confidence, repository, status, and assignee
- Sort by priority, confidence, age, or engagement
- Split view with queue on the left and preview on the right
- Keyboard-accessible next/previous navigation
- Approve, reject, correct, assign, and open-investigation actions
- Clear indication of public versus private security cases

Example row:

```text
[CRITICAL] Possible authentication bypass          94% confidence
#142 - security - opened 12 minutes ago             Review ->
```

### 7.3 Investigation detail

Purpose: show the agent's work without exposing private chain-of-thought.

Required sections:

1. Issue header, severity, category, status, and confidence
2. One-paragraph recommendation
3. Structured investigation trace
4. Retrieved evidence and source links
5. Similar-issue comparison
6. Classification and escalation factors
7. Proposed GitHub actions
8. Feedback and approval controls

Allowed trace content:

- Tool or data source used
- Start and completion timestamps
- Search query or operation category
- Number of records considered
- Retrieved source identifiers
- Structured intermediate classification
- Confidence and policy outcome
- Error or skipped-step reason

Do not expose hidden chain-of-thought, private reasoning tokens, system prompts, secrets, or raw credentials.

Suggested trace:

```text
[Complete] Fetched GitHub issue #142
[Complete] Searched 386 historical issues
[Complete] Retrieved three relevant closed issues
[Complete] Compared symptoms and affected versions
[Complete] Classified as likely regression - 91%
[Complete] Generated escalation recommendation
[Waiting]  Maintainer approval required
```

### 7.4 Similar-issue comparison

Purpose: distinguish a duplicate from a recurrence or merely related issue.

Required comparison fields:

- Issue title and state
- Semantic similarity
- Affected component
- Version or environment
- Reproduction overlap
- Resolution status
- Linked fixing PR or commit
- Relationship classification

Supported relationship labels:

- Duplicate
- Regression
- Related
- Known solution
- No meaningful match

### 7.5 Project-health page

Purpose: identify deterioration before it becomes a crisis.

Required metrics:

- First-response time
- Backlog growth rate
- Issue close rate
- Duplicate rate
- Contributor activity
- PR merge latency

Initial transparent weighting:

```text
Response health       25%
Backlog stability     20%
Issue resolution      20%
PR responsiveness     15%
Contributor activity  10%
Duplicate rate        10%
```

Repositories may configure these weights. Charts should include event annotations for releases, incidents, policy changes, and unusual activity.

### 7.6 Security centre

Purpose: privately triage potentially sensitive reports.

Recommended tabs:

```text
Detection | Investigation | Remediation | Policies
```

Required finding information:

- Provisional severity
- Confidence
- Affected component
- Evidence and source
- Visibility status
- Recommended response
- Human approval state

Potential vulnerabilities are private by default. Avoid automatically adding public `security` labels or comments that reveal suspected vulnerabilities.

### 7.7 Weekly brief

Purpose: summarize important repository activity without becoming a data dump.

Required sections:

- Issues opened versus closed
- PRs opened versus merged
- Pending escalations
- Health-score change with explanation
- Top three issues requiring attention
- Security notices
- Source links for material claims

### 7.8 Policies and automation

Purpose: make autonomy understandable and configurable.

Recommended policy actions:

- Allow automatically
- Require approval
- Suggest only
- Block

Example policy:

```yaml
permissions:
  investigate_issue: automatic
  suggest_label: automatic
  apply_label: approval_required
  post_public_comment: approval_required
  close_issue: prohibited
  publish_security_finding: prohibited
```

### 7.9 VS Code extension

The extension is a companion, not a second full product.

Minimum useful scope:

- Status-bar health and escalation count
- Escalation tree view
- Recent investigation list
- Toast notification for new critical escalation
- Commands to open the dashboard or trigger a permitted scan

Complex analytics, policy editing, and full evidence exploration should open the web dashboard.

---

## 8. Design direction

The interface should feel like a credible developer and security tool with a subtle Doom-inspired identity. It must not reproduce Marvel characters, logos, artwork, typography, or protected visual assets.

### Visual qualities

- Dark, technical, and information-dense without feeling crowded
- Emerald accent used for agent activity and primary actions
- Conventional severity colors retained for immediate comprehension
- Thin borders and layered dark surfaces
- Compact developer-tool typography
- Minimal decorative animation
- Evidence and status take priority over cinematic styling

### Color tokens

```css
:root {
  --background: #070a08;
  --surface-1: #0d120f;
  --surface-2: #101713;
  --surface-3: #17211b;
  --border: #24332a;

  --text-primary: #f1f5f2;
  --text-secondary: #b6c2ba;
  --text-muted: #87958c;

  --accent: #22c55e;
  --accent-bright: #4ade80;
  --accent-muted: #163d25;

  --critical: #f43f5e;
  --high: #fb7185;
  --warning: #f59e0b;
  --information: #38bdf8;
  --success: #22c55e;
  --neutral: #94a3b8;
}
```

Color must never be the only way status is communicated. Pair it with labels, icons, or text.

### Typography

- Primary UI: `Inter`, `Geist`, or a comparable sans-serif
- Code and evidence: `Geist Mono` or `JetBrains Mono`
- Minimum body text: 14px on desktop
- Avoid decorative movie-style fonts inside the product UI

### Spacing and shape

- Base spacing unit: 4px
- Common gaps: 8px, 12px, 16px, 24px, 32px
- Card radius: 8px to 12px
- Controls: 36px to 40px high
- Dense tables may use 32px to 36px rows
- Use one border and shadow system consistently

### Iconography

Use Lucide icons consistently:

| Meaning | Suggested icon |
|---|---|
| Security | `ShieldAlert` |
| Pull request | `GitPullRequest` |
| Issue | `CircleDot` |
| Investigation | `Search` |
| Agent | `BrainCircuit` |
| Health | `Activity` |
| Evidence history | `History` |
| Approved | `BadgeCheck` |
| Escalation | `TriangleAlert` |

---

## 9. Recommended frontend foundation

Use one primary component system to avoid inconsistent controls.

### Recommended stack

- React and TypeScript
- Tailwind CSS
- shadcn/ui for shell, controls, dialogs, cards, and tables
- Recharts or Tremor patterns for analytics
- Lucide for icons
- React Flow only if an interactive investigation graph materially improves the demo

Do not mix shadcn, Primer React, and Radix Themes as three competing component systems. GitHub Primer may be used as interaction inspiration while shadcn implements the actual interface.

### Component inventory

```text
AppShell
RepositorySelector
AgentStatusIndicator
HealthScoreCard
HealthMetricBreakdown
EscalationTable
EscalationPreview
SeverityBadge
ConfidenceIndicator
InvestigationTrace
InvestigationStep
EvidenceCard
SimilarIssueComparison
ApprovalPanel
AgentActivityFeed
HealthTrendChart
PolicyEditor
WeeklyBriefCard
EmptyState
ErrorState
SkeletonState
```

Components must be reused across dashboard and extension webviews when technically practical.

---

## 10. Interaction and state requirements

Every data-driven screen must design for:

- Initial loading
- Background refreshing
- Empty result
- Partial data
- Authentication failure
- GitHub rate limiting
- Agent or model failure
- RAG index unavailable
- Stale data
- Permission denied
- Successful action
- Action awaiting approval

### Confidence display

Confidence must be presented with its meaning, not as decorative precision.

Good:

> High confidence - strong semantic match and matching reproduction details.

Avoid:

> AI certainty: 94.3728%

Thresholds must be configurable and should eventually be calibrated against repository-specific feedback.

### Automatic comments

- Do not post the same request more than once before the author responds.
- Detect existing bot or maintainer requests.
- Support a repository-configurable cooldown.
- Support `no-bot` or equivalent opt-out policy.
- Allow preview and approval mode.

---

## 11. Accessibility and responsive behaviour

Minimum requirements:

- Full keyboard access to queue navigation and approval controls
- Visible focus states
- Semantic headings and landmarks
- Accessible names for icons and icon-only buttons
- WCAG AA color contrast for normal text
- Status communicated with text as well as color
- Reduced-motion support
- Tables convertible into stacked cards on narrow screens
- Charts accompanied by summaries or accessible data tables
- Dialogs trap focus and return it to the triggering control

Desktop is the primary hackathon target. The dashboard must remain usable on a tablet-width viewport; a fully optimized mobile experience is not required for the MVP.

---

## 12. Safety, privacy, and trust

### Autonomy policy

| Action | Default behaviour |
|---|---|
| Read repository metadata | Automatic after authorization |
| Investigate issue | Automatic |
| Retrieve historical evidence | Automatic |
| Suggest label | Automatic |
| Apply label | Approval required unless explicitly configured |
| Draft public comment | Automatic |
| Publish public comment | Approval required unless explicitly configured |
| Close issue | Prohibited by default |
| Modify or merge code | Outside MVP |
| Publish security finding | Prohibited |

### Data-handling rules

- Request minimum GitHub permissions.
- Never display or log access tokens.
- Do not send private repository content to an external model without clear configuration.
- Redact detected secrets from prompts, logs, and embeddings.
- Preserve source links and timestamps for important claims.
- Record who approved an external action.
- Keep an audit trail of automated and approved actions.

---

## 13. Reference products and reusable design resources

These references are for interaction research and inspiration. Do not reproduce proprietary branding or copy entire protected interfaces.

### Product references

1. [Linear Triage](https://linear.app/docs/triage?tabs=36dbc0f97e0d) - escalation inbox, prioritization, and fast triage.
2. [Sentry Issue Details](https://docs.sentry.dev/product/issues/issue-details/) - issue header, evidence, activity timeline, related issues, and suspect commits.
3. [CodeRabbit PR Walkthroughs](https://docs.coderabbit.ai/pr-reviews/walkthroughs) - structured AI reports, related issues, reviewer suggestions, and review status.
4. [Codacy Pull Requests](https://docs.codacy.com/repositories/pull-requests/) - quality gates, metric changes, annotated diffs, and analysis logs.
5. [GitHub Security Overview](https://docs.github.com/en/code-security/how-tos/view-and-interpret-data/analyze-organization-data/viewing-security-insights) - detection, remediation, security filters, and risk views.
6. [SonarQube Security Hotspots](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/issues/reviewing-security-hotspots) - human-reviewed security workflow.
7. [Socket Security Policies](https://docs.socket.dev/docs/security-policy-default-enabled-alerts) - block, warn, monitor, and ignore policy patterns.
8. [Grafana annotations](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/annotate-visualizations/) - health charts and event annotations.
9. [Better Stack Reporting](https://betterstack.com/docs/getting-started/team-and-account-management/reporting/) - incident trends and response analytics.
10. [GitGuardian incident patterns](https://docs.gitguardian.com/honeytoken/manage) - status filters, event history, and security timelines.

### Implementation resources

1. [shadcn/ui dashboard blocks](https://ui.shadcn.com/blocks?category=dashboard) - dashboard shell, sidebar, cards, charts, and data tables.
2. [Tremor templates](https://blocks.tremor.so/templates) - KPI, table, and analytical-dashboard patterns. Verify the applicable license before copying a complete template.
3. [React Flow](https://reactflow.dev/) - optional interactive workflow visualization.
4. [GitHub Primer](https://github.com/primer/design) - GitHub interaction and accessibility reference.
5. [Radix Themes](https://www.radix-ui.com/themes/docs/overview/getting-started) - alternative accessible component system, not an additional system to mix into shadcn.
6. [Lucide](https://lucide.dev/) - consistent open-source icon set.

### Recommended synthesis

- Use **Linear** for escalation-queue behaviour.
- Use **Sentry** for investigation details.
- Use **CodeRabbit** for structured agent reporting.
- Use **GitHub Security** for security views.
- Use **Codacy** for PR-analysis patterns.
- Use **Grafana** for health trends.
- Implement the interface with **shadcn/ui**, Tailwind, Recharts, and Lucide.

---

## 14. Definition of done for a UI feature

A UI feature is complete only when:

- It maps to an approved feature ID.
- It supports a defined user outcome.
- It uses existing tokens and shared components.
- Loading, empty, partial, error, and success states are implemented.
- Keyboard operation and focus behaviour work.
- Actions accurately reflect approval policy.
- Claims link to evidence where applicable.
- No secret, private reasoning, or token is exposed.
- Responsive behaviour has been checked.
- The feature is verified using realistic demo data.
- The README accurately reflects its implementation status.

---

## 15. Reusable master prompt for the team's AI assistant

Copy the following into the AI system that prepares future implementation prompts:

```markdown
You are the implementation-planning assistant for RepoGuardian, an agentic open-source maintainer assistant built for Codeissance 2026 PS-04.

Treat DESIGN.md as the project's design and scope source of truth. Do not assume that a described feature is already implemented. Inspect the current repository before proposing changes.

For every request:

1. Map it to the approved feature IDs F01-F14.
2. Return a scope verdict: In scope, In scope with constraints, Stretch, Out of scope, or Conflicts with specification.
3. Identify the exact user flow and screen or backend service affected.
4. Reuse existing components and architecture where possible.
5. Preserve the approved visual tokens, terminology, safety policies, and approval model.
6. Never request or expose hidden model chain-of-thought. Use a structured investigation trace containing tool activity, evidence, classifications, confidence, and outcome.
7. Keep suspected security issues private by default.
8. Do not perform destructive or public GitHub actions without the required approval policy.
9. Do not add new features, libraries, interfaces, or design systems unless the request requires them and the scope check justifies them.
10. Clearly separate MVP acceptance criteria from optional enhancements.

Generate implementation prompts with these sections:

- Scope verdict
- Feature mapping
- User outcome
- Current-state inspection required
- Functional requirements
- UI and interaction requirements
- Data/API assumptions
- Safety and approval requirements
- Accessibility requirements
- Acceptance criteria
- Explicit non-goals
- Verification plan

If the request conflicts with DESIGN.md, explain the conflict and propose the smallest compliant alternative instead of silently changing scope.
```

---

## 16. Codex attribution and usage note

This specification was prepared with research and synthesis assistance from **OpenAI Codex** using:

- The user-provided PS-04 problem statement
- The team's approved feature list
- Public official documentation linked in this file
- Design analysis conducted for the RepoGuardian hackathon project

Codex is a development assistant used during planning. It is not automatically part of RepoGuardian's runtime, architecture, branding, or product claims. Do not display OpenAI or Codex branding inside the product unless the team later integrates an OpenAI service and follows the applicable branding and attribution requirements.

This document does not imply that OpenAI endorses, sponsors, or certifies RepoGuardian or Codeissance 2026.

---

## 17. Final guardrail

When choosing between more features and a stronger demonstration, prioritize the stronger demonstration.

The product succeeds when judges can clearly see:

```text
Autonomous event handling
+ project-aware retrieval
+ multi-step investigation
+ selective escalation
+ evidence-backed explanation
+ responsible human approval
```

Everything else is secondary.
