# AGENTS.md — Codex Entry Point

**Codex: read `CLAUDE.md` in this same directory, in full, before your first edit.**

That file is the binding operating manual for this repository. It applies to you
exactly as it applies to Claude Code. This file only adds the parts specific to
how Codex works.

---

## Why two files

`CLAUDE.md` is the shared manual — architecture, rules, git workflow, file
ownership. `AGENTS.md` is the conventional entry point Codex looks for. Rather
than duplicate the manual (two copies drift, and a drifted rulebook is worse than
none), this file points at it and adds Codex-specific procedure.

**Order of reading:**

1. `CLAUDE.md` — the rules
2. `docs/DESIGN.md` — the design and scope source of truth
3. The `CLAUDE.md` of the folder you are about to edit
4. Nothing else, until you have finished the task

---

## The Codex working loop

Codex has no subagent model, so the discipline is different from Claude Code's:
**one file per session, always.**

```
1. READ      CLAUDE.md, then <folder>/CLAUDE.md
2. RESTATE   the exact contract you are implementing, in your own words
3. CONFIRM   the file is on your stream's ownership list (CLAUDE.md §5)
4. BRANCH    git checkout main && git pull && git checkout -b feat/<stream>-<slug>
5. IMPLEMENT only that file
6. VERIFY    run the verification command from the folder doc
7. COMMIT    conventional commit, specific paths, never `git add -A`
8. PR        rebase onto origin/main, push, open PR with the template
```

**Do not open a second file "while you're in there."** If a second file genuinely
needs changing, finish the first, commit it, and start a new session. A session
that touches four files produces a PR nobody can review at 3am.

---

## Before you write a line

Answer these four questions. If you cannot answer all four, stop and ask.

| Question | Where the answer lives |
|---|---|
| Which feature ID (F01–F14) does this serve? | `docs/DESIGN.md` §3 |
| Which stream owns this file? | `CLAUDE.md` §5 |
| What is the exact contract — signatures, types, behavior? | `<folder>/CLAUDE.md` |
| How will I prove it works? | `<folder>/CLAUDE.md` → Verification |

---

## Scope check — required

`docs/DESIGN.md` §4 requires a scope check before implementation. Produce it as
the first thing in your response:

```markdown
## Scope check
Verdict:  In scope | In scope with constraints | Stretch | Out of scope | Conflicts with spec
Feature:  F0X — <name>
Stream:   A | B | C | D
Files:    <exact paths you will touch>
Contract: <folder>/CLAUDE.md § <section>
```

If the verdict is anything other than "In scope," **stop and explain** rather than
narrowing, widening, or reinterpreting the task. `docs/DESIGN.md` §4 lists what
counts as a conflict — exposing hidden chain-of-thought, publishing suspected
vulnerabilities by default, destructive GitHub actions without approval, adding a
second design system, or presenting a planned feature as implemented.

---

## Hard limits

These repeat `CLAUDE.md` §2 because they are the ones most often broken:

- **Never commit to `main`.** Branch, PR, squash merge.
- **Never invent a filename.** If it isn't in a folder's `CLAUDE.md`, ask.
- **Never hardcode an MCP tool name.** Import from `mcp_server/tool_names.py`.
- **Never let a graph node import `memory/` or `api/`.** Nodes return
  `(patch, evidence)`; `@chain_step` does persistence and streaming.
- **Never edit `api/schemas.py`** after the contract freeze without announcing a
  breaking change and updating `dashboard/src/lib/types.ts` in the same PR.
- **Never use OpenAI.** This project runs Groq `llama-3.3-70b-versatile` plus
  local MiniLM embeddings. No `openai` package, no `gpt-*`, no `OPENAI_API_KEY`.
- **Never report success you did not verify.** Paste the actual command output.

---

## When Codex and Claude Code work the same repo

Both agents may be active at once on different streams. To stay out of each
other's way:

- Work only within your stream's ownership boundary (`CLAUDE.md` §5)
- Rebase onto `origin/main` before every push — not merge
- If you hit a conflict in a file you do not own, **stop**; the owner resolves it
- Do not "fix" another stream's file even when the fix is obvious. Open an issue
  or tell the owner. A silent cross-stream edit is how a merge queue deadlocks.

---

## Reporting

End every session with:

```markdown
## Done
<what you implemented, one or two sentences>

## Verified
<exact command, and its real output>

## Not done / assumptions
<anything incomplete, guessed, or surprising — be specific>

## Branch
feat/<stream>-<slug>  → PR #<n>
```

A known gap is recoverable. A silent one is what loses the demo.
