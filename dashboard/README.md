# Doombot Dashboard

React + Vite + TypeScript + Tailwind + shadcn/ui. The primary product surface (F13).

## Read before working here

| File | What |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **Shared frontend rules — tokens, UI states, a11y, safety, WS strategy** |
| [FRONTEND-C.md](FRONTEND-C.md) | Person C — investigation trace, evidence, comparison |
| [FRONTEND-D.md](FRONTEND-D.md) | Person D — shell, overview, escalations, health |
| [../docs/DESIGN.md](../docs/DESIGN.md) | Design source of truth — screens, tokens, safety |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Backend runs on `:8000`. Set `VITE_USE_MOCKS=true` in `.env.local` to run with no
backend at all.

---

## Stretch features

### F15 — Issue relationship graph (`/graph`)

`IssueGraph.tsx` renders a force-directed view of how a repository's issues
relate. The spatial layout *is* the information: the simulation pulls similar
issues together and pushes unrelated ones apart, so recurring-bug clusters and
duplicate chains become visible in a way a list cannot show.

Data shape matches `rag.graph.build_graph`, so switching from fixtures to
`GET /api/repos/{owner}/{repo}/graph` is a data-source change only.

Encoding — colour is never the only signal:

| Element | Meaning |
|---|---|
| Node colour | Category (security, duplicate, stale, resolved, open) |
| Node size | Engagement (reactions + comments), square-rooted |
| Ring around node | Currently escalated |
| Node label | Issue number, drawn on canvas at any zoom above 1.1 |
| Solid edge | Likely duplicate (>0.85 similarity) |
| Dashed edge | Related (0.65–0.85) |
| Arrowed edge | Explicit `#123` reference |

Click an edge and it reports *why* the two issues are connected. A screen
reader gets a visually hidden table of every issue and its connections.

**`react-force-graph-2d` is lazy-loaded.** It touches `window` at module
scope, so a static import throws `window is not defined` wherever there is no
DOM — which breaks `npm run render-check`. Lazy-loading also keeps d3-force
out of the initial bundle, since four of the five routes never need it.

**Not built:** the 3D toggle and the PR blast-radius overlay. `STRETCH_FEATURES.md`
marks the overlay "if time permits", and both are additive to this component.
