# Doombot — Auto-Fix PRs

**The agent doesn't just find the fix — it applies it.**

---

## What it does

When the agent resolves an issue by finding a similar past issue that was fixed, it goes one step further. Instead of posting a comment with the code snippet and waiting for a human to apply it, the agent checks if the same fix can be applied to the current codebase. If it can, the agent creates a branch, applies the patch, and opens a draft PR — linking the new issue, the original issue, and the original fix PR.

The maintainer wakes up to a draft PR with the fix already applied. They review it, confirm the tests pass, and merge. The bug is fixed without a human writing a single line of code.

## How it works

**Step 1 — Resolution match.** This already happens. The intelligent issue resolution feature finds a closed issue with high similarity (above 0.75) that has a linked merged PR. The code snippets feature extracts the relevant diff hunks. No new work here.

**Step 2 — Patch applicability check.** The agent fetches the current state of the files that were modified in the original fix PR. It compares the code surrounding the fix location in the original PR against the current codebase. If the surrounding context still matches (the lines before and after the fix haven't been refactored or moved), the patch is considered applicable. If the context has diverged significantly, the agent falls back to posting the code snippet in a comment and skips the PR.

This is the same logic `git cherry-pick` uses — check if the context lines around the diff hunk still exist in the target. The agent doesn't need to understand the code semantically. It's a structural patch match.

**Step 3 — Branch creation.** The agent creates a new branch via the GitHub API: `doombot/fix-{issue_number}`. No local git clone is needed. The GitHub Contents API allows creating and updating files directly on a branch through REST calls.

**Step 4 — Patch application.** The agent applies the diff to the target files on the new branch. For simple hunks (single-file, under 20 lines), this is a direct content replacement using the GitHub Contents API's update file endpoint. The agent reads the current file content, applies the hunk at the correct line offset, and commits the modified file to the branch with a message: "fix: apply patch from PR #{original_pr} to resolve #{new_issue}."

**Step 5 — Draft PR creation.** The agent opens a draft PR from the fix branch to the default branch. The PR body contains:

- A summary of the issue and the fix.
- A link to the original issue that had the same problem.
- A link to the original PR that fixed it.
- The code diff being applied.
- A disclaimer: "This fix was automatically applied by Doombot based on a similar past fix. Please review before merging."

The PR is opened as a **draft** — never as ready for review. The agent never merges anything. The maintainer always has final approval. This is a deliberate design choice: the agent does the work, the human makes the decision.

**Step 6 — Issue comment.** The agent posts a comment on the original issue: "I found a similar fix from PR #145 and opened a draft PR (#302) applying the same patch. Please review it." The issue is not closed — it stays open until the maintainer merges the PR and closes it manually (or sets up GitHub's auto-close on merge).

## Safety guardrails

**Small patches only.** The agent only attempts auto-fix for diffs under 20 lines of actual code changes (not counting blank lines or comments). Large diffs have too many ways to break when applied to a different codebase state.

**Context match required.** If the 3 lines above and below the fix location have changed since the original PR, the patch is not applied. The agent posts the code snippet instead and lets the human adapt it manually.

**Single-file fixes only.** Multi-file fixes require understanding cross-file dependencies that a structural patch match can't verify. The agent only auto-fixes when the original PR's relevant change was in a single file.

**Draft PRs only.** The agent never opens a ready-for-review PR and never merges. The maintainer always reviews. This is non-negotiable.

**Test awareness.** If the repository has CI configured (detected by the presence of `.github/workflows/` or similar), the PR description notes: "CI will run automatically on this PR. Please check test results before merging." The agent doesn't run tests itself — it relies on the repo's existing CI pipeline to validate the fix.

**Rollback simplicity.** Because the fix is on an isolated branch with a single commit, reverting is trivial if the patch turns out to be wrong. The agent mentions this in the PR description.

## What the judge sees

An issue is filed describing a crash. The agent investigates — the investigation chain animates in the dashboard. It finds a similar resolved issue with a 5-line fix. Instead of just posting a comment, the agent says "fix applicable — opening draft PR." Ten seconds later, a draft PR appears on GitHub. The judge clicks through and sees the branch, the commit, the diff, and the PR description linking everything together.

The agent went from detecting a problem to opening a fix in under a minute. No human touched it. The maintainer's job is reduced to reviewing a 5-line diff and clicking merge.

That's the moment a judge says "this isn't a hackathon project."

## Integration with existing features

**Intelligent issue resolution** — auto-fix is the next step after resolution. The resolution feature finds the match and posts the explanation. The code snippets feature extracts the diff. Auto-fix applies it.

**Investigation chain** — two new steps appear: "Patch applicability check — context lines match, fix can be applied" and "Draft PR opened — #302 on branch doombot/fix-28502."

**MCP tools** — a new tool `auto_fix_issue` that external AI clients can call to trigger the fix flow. The tool returns the PR URL if successful or a reason why the fix couldn't be applied.

**Dashboard** — the escalation card for the issue updates with a green "Fix PR opened" badge and a link to the draft PR.

**Chrome extension** — the issue sidebar shows a "Draft fix available" banner with a link to the PR.

## Implementation

**GitHub API calls used:**
- `GET /repos/{owner}/{repo}/pulls/{pr}/files` — fetch original fix diff (already done in code snippets feature)
- `GET /repos/{owner}/{repo}/contents/{path}` — read current file content
- `PUT /repos/{owner}/{repo}/contents/{path}` — commit modified file to new branch
- `POST /repos/{owner}/{repo}/git/refs` — create fix branch
- `POST /repos/{owner}/{repo}/pulls` — open draft PR
- `POST /repos/{owner}/{repo}/issues/{number}/comments` — comment on issue

All of these are standard PyGithub operations. No git clone, no local filesystem, no Docker. Everything happens through the REST API.

**Dependencies:** None new. PyGithub handles every API call. The diff parsing from the code snippets feature provides the patch content. The resolution feature provides the match.

**Estimated effort:** 3-4 hours. One hour for the patch applicability check (context line comparison). One hour for the branch creation and file update via the GitHub Contents API. One hour for the draft PR creation with the formatted description. 30 minutes for the safety guardrails (size limits, single-file check, context match verification). 30 minutes for testing on a real repository.

---

## Deviations from the original spec, and why

Recorded here rather than left implicit, because the next person will compare
the code against this document.

- **Branch prefix is `doombot/fix-`, not `repoguardian/fix-`.** The spec was
  written under the project's earlier name. Every other string the agent
  writes to GitHub says Doombot (see `decider.COMMENT_MARKER`), and a branch
  called `repoguardian/...` in a Doombot demo reads as a different tool's work.

- **The MCP tool is registered as `auto_fix_issue_mcp`.** The spec calls it
  `auto_fix_issue`; the `_mcp` suffix is the convention every other tool in
  `mcp_server/tool_names.py` follows, and root `CLAUDE.md` rule 5 exists to
  stop exactly this kind of name drift.

- **Dashboard and Chrome extension surfaces are not built here.** This branch
  demos the VS Code extension only; the dashboard and the browser extension
  live on their own branches. The VS Code surface is the context-menu command,
  the toast, and the fix-PR badge on the tree rows.

- **Opening a PR unattended is opt-in.** `DOOMBOT_AUTO_FIX=1` enables the
  graph to open a draft PR on its own, and `DEMO_MODE=1` always overrides it.
  Off by default, mirroring `DOOMBOT_AUTO_RESOLVE`: a pull request on someone
  else's repository is the most consequential write in the product. A human
  invoking "Doombot: Open Auto-Fix PR" is its own authorization and does not
  need the flag — only `DEMO_MODE` can stop that path.

- **A test file alongside the source fix does not count as multi-file.** The
  spec's single-file rule is about cross-file dependencies a structural match
  cannot verify. Most real fixes touch the source file and its test, and
  rejecting those would reject nearly everything. Only the source file is
  patched.

- **An ambiguous match is refused.** If the hunk's context appears more than
  once in the current file, the patch is not applied. The spec does not
  mention this case; picking one of two identical locations would be a silent
  wrong answer, which is worse than no fix.

---

*This feature is the final link in the chain: detect → investigate → find similar fix → extract code → verify applicability → apply fix → open PR. Each step was built independently. This feature connects them into an end-to-end autonomous fix pipeline.*

*Built for Codeissance 2026 — PS-04*
