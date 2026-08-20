# Intelligence Features — F17, F18

Two additions that extend what Doombot already has rather than introducing new
infrastructure. Both are **specifications, not descriptions**: neither is built
yet. Status is tracked in the root `README.md` table and `docs/FEATURES.md`, and
nothing here should be read as shipped until it is merged and demonstrated
(root `CLAUDE.md` §9).

> **Provenance note.** This document is adapted from an `INTELLIGENCE_FEATURES.md`
> written against a project called *RepoGuardian*. That draft assumed several
> things Doombot does not have: a Chrome extension, a `.repoguardian/standards.yml`
> conventions file, and a `get_dependabot_alerts` MCP tool. Those are dropped
> here rather than silently inherited. What remains is mapped onto modules that
> actually exist in this repository.

---

## F17 — Adaptive repository learning

**Priority: P2, stretch. Stream B. Branch: `feat/b-adaptive-learning`.**

### The idea

When the labeler classifies a new issue, it asks the model to judge the issue on
its own. A repository's maintainers have usually already answered that question
hundreds of times — every closed issue is a labelled example, and every label
they applied is a classification decision. Using that history as few-shot
context grounds the classification in the project's own conventions instead of
the model's general priors.

### What already exists

This is the reason the feature is cheap, and it is worth being precise about it:

| Piece | Where | State |
|---|---|---|
| Issue embeddings, one document per issue | `rag/embedder.py` `index_issues` | **Built** |
| `state` and `labels` in Chroma metadata | `rag/embedder.py` | **Built** |
| `reactions` / `comments` in metadata | `rag/embedder.py` | **Built** |
| Cosine similarity search over issues | `rag/retriever.py` | **Built** |
| Duplicate thresholds (0.85 / 0.65) | `rag/retriever.py`, `rag/graph.py` | **Built** |
| Few-shot prompt from *closed* issues | `agents/triage/labeler.py` | **Not built** |

So the retrieval half is done. What is missing is one query filtered to closed
issues, and the prompt assembly that turns their labels into examples.

### What to build

In `agents/triage/labeler.py`, before the classification call:

1. Query the `{repo}-issues` collection for the nearest neighbours of the issue
   under triage, filtered to `state == "closed"`.
2. Keep the top 3–5 above the related threshold (0.65 — reuse
   `RELATED_THRESHOLD`, do not invent a second number).
3. Render them as examples, each carrying its number, similarity, and the
   labels the maintainer actually applied.
4. Emit the retrieved set as **evidence** on the step, so the chain shows which
   past issues informed the classification and at what similarity. A
   classification the reader cannot trace back is exactly the black box this
   product exists to avoid.

Prompt shape:

```
In this repository, maintainers have handled similar issues like this:
  #142 (0.87) — labels: bug           — closed
  #203 (0.81) — labels: bug,duplicate — closed
  #89  (0.76) — labels: security      — closed

Classify the new issue below, following this repository's conventions.
```

### Why few-shot rather than fine-tuning

A fine-tuned model freezes the conventions present in its training data. When a
project's labelling scheme changes, the model is stale until retrained. A
retrieval-grounded prompt reads the latest decisions on every call, so it tracks
convention drift with no retraining step. It also works immediately on a
repository with twenty closed issues, where a trained model would have nothing
to learn from.

The honest limitation: **a repository with no closed issues gets no benefit.**
The feature must degrade to today's behaviour rather than degrade the
classification — if the filtered query returns nothing, skip the examples and
classify as now. Do not fabricate examples, and do not let an empty history
silently lower confidence.

### Definition of done

- [ ] Closed-issue retrieval filtered in the query, not in Python after the fact
- [ ] Thresholds imported, not redefined
- [ ] Retrieved examples appear as step evidence with numbers and scores
- [ ] Empty history falls back cleanly to the current prompt
- [ ] `tests/test_retriever.py` extended for the closed-issue filter

---

## F18 — MCP intelligence layer

**Priority: P2, stretch. Stream B. Branch: `feat/b-mcp-intelligence`.**

### The idea

Doombot's MCP server currently exposes GitHub *to Doombot*. All nine registered
tools are passthroughs — `get_issue_mcp`, `post_issue_comment_mcp`,
`add_labels_mcp`. Nothing exposes Doombot's own analysis *to anything else*.

Adding a second class of tool makes the protocol bidirectional: inbound from
external MCP clients, outbound to GitHub. Any MCP-capable client could then ask
about a repository and get Doombot's grounded analysis instead of a guess.

### What already exists

| Piece | Where | State |
|---|---|---|
| FastMCP stdio server | `mcp_server/server.py` | **Built** |
| 9 GitHub passthrough tools | `mcp_server/tools.py` | **Built** |
| Shared tool-name constants | `mcp_server/tool_names.py` | **Built** |
| Health scoring | `api/health.py` | **Built** |
| Escalation queue, investigations | `memory/repo.py` | **Built** |
| Duplicate detection | `rag/retriever.py` | **Built** |
| Issue + code graph | `rag/graph.py` | **Built** |
| Weekly brief | `api/routes_repos.py` | **Built** |
| Any tool exposing the above over MCP | — | **Not built** |

Every capability is already implemented and reachable over HTTP. F18 is a second
interface onto existing functions, not new analysis.

### Tools to register

Names go in `mcp_server/tool_names.py` — never hardcode a tool name at a call
site (root `CLAUDE.md` rule 5; name drift caused 2 of the 8 prototype bugs).

| Tool | Backed by | Returns |
|---|---|---|
| `search_issues_mcp` | `rag/retriever.py` | semantic matches with similarity scores |
| `find_duplicates_mcp` | `rag/retriever.py` | near-duplicates for one issue, with a verdict |
| `get_escalations_mcp` | `memory/repo.py` | the queue, with severity and reasoning |
| `get_health_score_mcp` | `api/health.py` | score, four-axis breakdown, `measured` flag |
| `get_investigation_mcp` | `memory/repo.py` | one chain replayed, step by step |
| `get_issue_graph_mcp` | `rag/graph.py` | nodes and links |
| `get_weekly_brief_mcp` | `api/routes_repos.py` | the same counts the dashboard shows |

`get_health_score_mcp` must pass through `measured` and `unreadable`. The API
learned this the hard way: three of the four sub-scores return 100 for an empty
backlog, so a bare score claims perfect health for a repository nothing has been
read from. An MCP client has even less context to catch that than a human
looking at a dashboard.

### Boundaries that still apply

- **Read-only.** No MCP tool may post a comment, apply a label, or close an
  issue. Writes stay behind the decider's approval gates (`agents/triage/decider.py`),
  which exist precisely so actions are not taken without a maintainer. An
  external client must not be able to route around them.
- **Rule 7 is unaffected.** These tools live in `mcp_server/`, so a graph node
  still never touches SQLite or the socket hub.
- **No new analysis.** If a tool needs logic that does not exist yet, that is a
  different feature. F18 is exposure only.

### Definition of done

- [ ] Every tool name imported from `mcp_server/tool_names.py`
- [ ] No tool performs a GitHub write
- [ ] `get_health_score_mcp` carries `measured` and `unreadable`
- [ ] Demonstrated end to end with MCP Inspector, output pasted in the PR
- [ ] `mcp_server/CLAUDE.md` updated with the new tool table

---

## Scope check

Per `docs/DESIGN.md` §4, both are **P2 stretch, in scope with constraints**:

- Neither blocks the fourteen approved features.
- Neither adds a dependency (`requirements.txt` unchanged).
- F17 is a prompt and a query in one existing node.
- F18 is tool registration over functions that already work.

**Cut order:** F18 before F17. F17 improves a P0 path (classification quality on
the demo repository); F18 is a second interface onto capability already visible
in the dashboard, so cutting it loses the least.

---

*Codeissance 2026 — PS-04*
