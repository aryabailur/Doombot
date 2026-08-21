# RepoGuardian

**Agentic Open-Source Maintainer Assistant**

An AI-powered system that monitors GitHub repositories, triages issues, detects duplicates, enforces code standards, and surfaces what matters — available as both a **web dashboard** and a **VS Code extension**.

> Built for Codeissance 2026 — PS-04 by Team [Your Team Name]

---

## The problem

GitHub repositories receive hundreds of issues and pull requests, but maintainers have limited time. Critical security reports get buried under feature requests. Duplicates pile up. Stale issues linger without follow-up. Nobody notices when project health starts declining until it's too late.

RepoGuardian is an always-on AI agent that watches your repository, investigates what matters, enforces your standards, and only interrupts you when it's worth your attention.

---

## Feature map

### Compulsory features (from PS-04)

**1. GitHub integration**
Full read/write access to issues, pull requests, comments, labels, repository activity, and commit history via the GitHub REST API and webhooks. The agent operates on real repository data, not snapshots.

**2. Agentic repository monitoring**
A background agent continuously polls for new activity and autonomously creates subtasks: duplicate checks on new issues, missing-information requests for bug reports without reproduction steps, health-trend investigations when metrics shift, and security scans on flagged keywords. The agent decides what to investigate next without human prompting.

**3. Project-aware RAG**
All historical issues, pull requests, discussions, commit messages, and maintainer decisions are indexed into a vector store (ChromaDB). When the agent investigates an issue, it retrieves relevant context from the project's own history — not generic knowledge. This means the agent learns how *your* project handles things: which labels you use, how you triage, what patterns recur.

**4. Selective escalation**
Not every issue needs a human. The agent classifies issues into categories (security, stale, duplicate, contentious, high-impact) and only escalates the ones that genuinely need attention. Each escalation includes a written explanation of *why* it was escalated, with links to the evidence.

**5. Project health analysis**
Track response time, backlog growth, duplicate rate, contributor activity, and issue close rate over time. Surface trends before they become crises — "response time increased 40% this month" or "3 contributors went inactive in the last 2 weeks."

**6. Explainability and feedback**
Every AI decision links back to the source issues and PRs that informed it. Maintainers can mark decisions as correct or incorrect, and that feedback is stored for future evaluation. The agent never makes a claim it can't cite.

---

### Key features (discussed and built)

**7. Multi-step investigation chain**
When the agent investigates an issue, it runs a visible chain of reasoning: fetch issue details → semantic search via RAG → duplicate detection with cosine similarity → pattern matching against known categories → severity assessment → generate recommendation. Each step is logged with its duration and result, so judges (and maintainers) can see exactly how the AI reached its conclusion.

**8. Semantic duplicate detection**
Issues are embedded using sentence-transformers (or OpenAI embeddings). When a new issue arrives, the agent computes cosine similarity against all existing issues. Matches above 0.85 are flagged as likely duplicates with a side-by-side comparison. Matches between 0.65–0.85 are flagged as "related" for context.

**9. Security-sensitive issue detection**
A keyword + classifier pipeline scans every new issue for security indicators: XSS, injection, CSRF, bypass, vulnerability, exploit, authentication, authorization. Matched issues are auto-escalated to the security queue with higher priority, and the agent recommends whether to request a CVE triage.

**10. Maintainer weekly brief**
Every Monday (or on demand), the agent generates a concise summary: how many issues opened/closed, which escalations are pending, health score changes, notable contributor activity, and a list of the 3 most important things the maintainer should look at this week.

**11. Real-time WebSocket updates**
Both the dashboard and VS Code extension receive live updates via WebSocket. When the agent finishes an investigation, detects a duplicate, or escalates an issue, the UI updates instantly — no manual refresh needed.

**12. Dual interface — dashboard + VS Code extension**
The web dashboard is for the big-picture view: health charts, escalation queues, trend analysis. The VS Code extension is for developers who live in their editor: sidebar tree views, inline notifications, investigation panels, and a status bar showing live health score. Both hit the same FastAPI backend.

**13. AI provider abstraction**
A clean provider layer supports OpenAI (default), Yotta Shakti Cloud (optional, if access is granted), or a fully local mode using sentence-transformers and keyword classifiers with zero API keys. Switch providers with one environment variable — no code changes.

---

### Additional features

**14. DRY code standard enforcement**
Different tech stacks have different conventions for keeping code DRY — React components should be extracted at a certain size, Python modules should avoid circular imports, utility functions should live in shared directories, CSS should use variables not hardcoded values. RepoGuardian loads a per-repository `.repoguardian/standards.yml` config that defines these rules per language. When the agent reviews a PR or scans the codebase, it checks for violations: duplicated logic across files, components that should be extracted, repeated magic numbers, copy-pasted blocks with minor variations. Findings are reported with specific file/line references and a suggested refactor. The standards config is version-controlled alongside the codebase, so the rules evolve with the project.

Example `.repoguardian/standards.yml`:
```yaml
standards:
  python:
    max_function_length: 50
    max_file_length: 400
    duplicate_threshold: 0.80  # cosine similarity between function bodies
    enforce_typing: true
    banned_patterns:
      - "import *"
      - "except Exception:"
  javascript:
    max_component_lines: 150
    extract_threshold: 3  # if a JSX block repeats 3+ times, flag it
    enforce_named_exports: true
  css:
    no_hardcoded_colors: true
    no_magic_numbers: true
  general:
    max_duplicate_blocks: 2  # flag if same 5+ line block appears 3+ times
    require_docstrings: true
```

**15. GitHub Security integration**
Connect to GitHub's built-in security features and extend them with AI reasoning:
- **Dependabot alert triage**: when Dependabot flags a vulnerability, the agent checks if the vulnerable dependency is actually reachable in your code paths (not just installed but unused). Unreachable vulnerabilities are deprioritized; reachable ones are escalated with impact analysis.
- **Secret scanning response**: if GitHub detects a leaked secret, the agent immediately escalates with severity context — is it a production key or a test token? Has it been used in recent commits? It recommends rotation steps specific to the secret type (AWS key vs GitHub token vs database password).
- **Code scanning integration**: pull results from CodeQL or other SAST tools, correlate them with open issues, and deduplicate findings that map to the same root cause. Instead of 15 separate CodeQL alerts, the maintainer sees "3 SQL injection patterns in the auth module" with a single investigation chain.
- **Security advisory drafting**: when a confirmed vulnerability is found, the agent drafts a GitHub Security Advisory with the affected versions, severity assessment (CVSS score estimation), and suggested patch description based on the fix PR.

**16. GitHub Actions integration**
The agent doesn't just observe — it can act (with maintainer approval):
- **Auto-labeling**: after classifying an issue (bug, feature, question, security, duplicate), the agent applies the appropriate labels via the GitHub API. Labels are only applied after the maintainer approves in the escalation queue, or automatically for high-confidence classifications (configurable threshold).
- **Auto-comment on incomplete issues**: when a bug report is missing reproduction steps, environment info, or version numbers, the agent posts a templated comment requesting the specific missing information. The template is customizable per repository.
- **PR quality gate**: a GitHub Action runs on every PR that calls the RepoGuardian API to check for DRY violations, style inconsistencies, and whether the PR addresses a known issue. Results are posted as a PR review comment with pass/fail status.
- **Stale issue management**: issues that match stale criteria (no activity for N days, no assignee, no milestone) are auto-commented with a warning, and if still inactive after a grace period, auto-closed with a "closed as stale" label. Thresholds are configurable.
- **CI failure analysis**: when a GitHub Actions workflow fails, the agent reads the logs, identifies the likely cause (test failure, build error, dependency issue, flaky test), and posts a summary comment on the PR explaining what broke and suggesting a fix.
- **Release notes generation**: when a release is tagged, the agent scans all merged PRs since the last release, categorizes them (features, bugfixes, breaking changes, dependencies), and drafts release notes in keep-a-changelog format.

**17. Adaptive contributor follow-up**
When a new issue is filed, the agent checks if the author has filed issues before in this repo. First-time contributors get a welcome message and a checklist of what makes a good bug report. Repeat contributors who consistently file good reports are fast-tracked. Contributors whose issues are frequently closed as duplicates get a gentle nudge to search existing issues first.

**18. Project health forecasting**
Beyond tracking current metrics, the agent fits trend lines to historical data and predicts where things are heading. "At the current rate, your backlog will double in 6 weeks" or "Contributor activity is declining — you've lost 2 active contributors per month for the last quarter." Predictions use simple linear regression on time-series health data, not an LLM — it's real ML.

**19. MCP protocol server**
Expose the entire RepoGuardian knowledge base through an MCP-compatible tool server. External AI clients (Claude, other agents) can query your repository's health, search issues, request investigations, and get escalation summaries — all through the standardized MCP protocol. This means your repository intelligence is composable with other AI tools.

---

### Bonus features (from PS-04, time permitting)

**20. Automated GitHub Actions workflows**
Ship a pre-built `.github/workflows/repoguardian.yml` that teams can drop into any repo. The workflow triggers on issue/PR events and calls the RepoGuardian API for triage, labeling, and quality checks.

**21. Contributor reputation scoring**
Track contributor patterns over time: do their issues get resolved or closed as invalid? Do their PRs pass review on the first try? Use this to weight escalation priority — a report from a trusted contributor gets more attention.

**22. Cross-repository analysis**
For organizations with multiple repos, detect patterns across projects: "the same dependency vulnerability affects 4 of your repos" or "this contributor opened similar issues in 3 projects — likely a shared upstream problem."

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              AI Provider (swappable)                  │
│  OpenAI (default) / Shakti Cloud (opt) / Local       │
│  Embeddings · Classifier · LLM reasoning             │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────┐
│                  FastAPI Backend                       │
│  Agents · RAG (ChromaDB) · MCP Server · WebSocket    │
└──────────┬───────────────────┬───────────┬───────────┘
           │                   │           │
     ┌─────┴─────┐    ┌───────┴──┐   ┌────┴─────┐
     │ Dashboard  │    │ VS Code  │   │ GitHub   │
     │ (React)    │    │Extension │   │ Actions  │
     └───────────┘    └──────────┘   └──────────┘
```

## Tech stack

**Backend**: Python 3.11+, FastAPI, LangChain, ChromaDB, PyGithub, sentence-transformers
**Dashboard**: React 18, TypeScript, Vite, Tailwind CSS, Recharts
**Extension**: VS Code Extension API, TypeScript, Webview panels
**AI**: OpenAI API (default) | Shakti Cloud (optional) | Local (sentence-transformers + keyword classifier)
**Integrations**: GitHub REST API, GitHub Webhooks, GitHub Actions, GitHub Security, MCP Protocol

## Quick start

```bash
# Backend
cd backend && cp .env.example .env  # fill in GITHUB_TOKEN and OPENAI_API_KEY
pip install -r requirements.txt --break-system-packages
uvicorn main:app --reload --port 8000

# Dashboard
cd dashboard && npm install && npm run dev

# VS Code extension
cd vscode-extension && npm install && npm run compile
# Press F5 in VS Code to launch
```

## Team

| Member | Role |
|---|---|
| [Name 1] | Backend + AI agents |
| [Name 2] | Dashboard + shared UI |
| [Name 3] | VS Code extension + GitHub integrations |

---

*Built at Codeissance 2026, TSEC CodeStorm*
