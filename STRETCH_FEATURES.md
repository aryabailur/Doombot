# Doombot — Stretch Features

Two additional features attempted after the core 14 were shipped. Inspired by
competitive research on prize-winning hackathon projects and production-grade
maintainer tools.

> **Implementation status.** Both features have their backend and dashboard
> halves built and merged.
>
> - **F15** renders from fixtures until Stream A ships
>   `GET /api/repos/{owner}/{repo}/graph`. The computation
>   (`rag.graph.build_graph`) is done and verified against real embeddings.
> - **F16** is **approval-gated by default** rather than auto-posting as
>   described below. `DESIGN.md` §12 makes publishing a public comment
>   approval-required, and this is the riskiest write in the product — a wrong
>   answer posted under the project's name costs trust as well as time.
>   `DOOMBOT_AUTO_RESOLVE=1` opts into auto-posting; `DEMO_MODE=1` always
>   overrides it. See `agents/CLAUDE.md` §12.
> - **Not built:** the 3D toggle and the PR blast-radius overlay. The spec
>   marks the overlay "if time permits", and both are additive to the existing
>   `IssueGraph` component.

---

## 15. Issue Relationship Graph

*Inspired by GraphDev (Anthropic Grand Prize, GitLab AI Hackathon 2026)*

An interactive force-directed graph visualising the relationships between
issues in a repository. Instead of a flat list, maintainers see the shape of
their backlog — clusters of related bugs, isolated security reports, duplicate
chains, and the connections between them.

**How it works:**

Every indexed issue is a node. Edges come from three signals: semantic
similarity from the RAG pipeline (cosine between embeddings), explicit
references (issue #X mentions issue #Y), and shared metadata (same labels).
Tightly connected nodes cluster naturally, revealing patterns invisible in a
list view.

No new ML pipeline is needed — the relationships already exist in the
`{repo}-issues` Chroma collection that duplicate detection populates.

**Node encoding:**

Colour by triage category — security, duplicate, stale, resolved, open. Size
scales with engagement (reactions + comments), square-rooted so one very busy
issue does not dwarf everything else. A ring marks nodes currently escalated.
The issue number is drawn on canvas at any meaningful zoom, so the graph is
readable without colour. Hovering shows the title; clicking opens the
investigation.

**Edge encoding:**

Width scales with similarity. Solid lines are likely duplicates (>0.85),
dashed are related (0.65–0.85), and arrows mark explicit references. Clicking
an edge reports *why* two issues are connected — "0.92 cosine similarity" —
grounding the visual in explainable data. An edge you cannot interrogate is
decoration, not evidence.

**Two rules that make it readable:**

Edges below 0.65 are dropped entirely: with 50+ issues every pair has *some*
similarity, and drawing all of them produces a hairball. A label held by more
than a third of the repo is skipped: `bug` would connect everything to
everything and destroy the clustering the graph exists to show.

**Interaction:**

Pan, zoom, drag. A filter row toggles categories, with live counts. "Fit to
view" reframes the simulation.

**Implementation:**

`rag/graph.py` computes `{nodes, links, stats}`.
`dashboard/src/components/IssueGraph.tsx` renders it with
`react-force-graph-2d`, lazy-loaded because the library touches `window` at
module scope and would otherwise break any DOM-less environment. The `/graph`
route sits in the dashboard nav; the VS Code extension exposes
`Doombot: Open Issue Graph`, which opens the same route in its webview rather
than reimplementing the graph natively.

**Accessibility:**

A visually hidden table lists every issue and its connections, since a canvas
conveys nothing to a screen reader.

---

## 16. Intelligent Issue Resolution

*Inspired by Dosu (used by Apache Superset, Apache Airflow, LlamaIndex)*

The agent doesn't just triage — it attempts to resolve. When a new issue
resembles a previously resolved one, the agent drafts a contextual response
suggesting the solution that worked before, citing the original issue.

**How it works:**

After duplicate detection, a resolution step searches the RAG index for
*closed* issues above 0.75 similarity, reads the resolution context, and
generates a response tailored to the new issue.

**The response is not a copy-paste.** The LLM synthesises a reply addressing
the new issue's specifics while drawing on the prior solution — for example:
"This looks similar to #247, which was caused by a missing null check in the
auth middleware, fixed in PR #251. If you're on 3.2+ this should already be
resolved — can you confirm your version?"

**Three gates, all required:**

1. Similarity to a closed issue ≥ 0.75. Lower than the 0.85 duplicate bar on
   purpose: a resolution does not require the reports be the same, only that
   the old fix plausibly applies.
2. The old issue has a **substantive** resolution. A closed issue is not a
   resolved issue — plenty are closed as stale or duplicate with no
   explanation.
3. A self-consistency check confirms the draft addresses **this** issue rather
   than restating the old one. A draft that only describes the prior issue is
   exactly the copy-paste behaviour this feature exists to avoid.

Any failure falls back to standard triage. **Silence is the correct output
most of the time.**

**The write is gated twice:**

| `DOOMBOT_AUTO_RESOLVE` | `DEMO_MODE` | Posts? |
|---|---|---|
| unset | any | No — draft held for approval |
| `1` | unset/`0` | Only if confidence ≥ 0.80 |
| `1` | `1` | No — `DEMO_MODE` always wins |

The gate lives in `decider`, the only node permitted GitHub side effects, so
the decision to write and the write itself stay in one auditable place.

**Decision priority:**

`resolve` ranks below security and above `close_duplicate`. Telling an author
how to fix their problem beats pointing them at another open thread — but
neither beats a possible vulnerability.

**What makes this different from a chatbot:**

It is grounded in the project's own history. It finds a specific prior issue,
reads the specific fix applied, and cites both. If it cannot find a grounded
resolution it stays silent rather than guessing.

**Implementation:**

`agents/triage/resolver.py`, wired between `duplicate_detector` and
`security_scanner` — it needs the similarity search and must not pre-empt a
security escalation.

---

*Both features are self-contained. Neither blocks nor depends on the other.*

*Built for Codeissance 2026 — PS-04*
