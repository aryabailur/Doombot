# Doombot Dashboard

React + Vite + TypeScript + Tailwind + shadcn/ui. The primary product surface (F13).

**Not yet scaffolded.** See [CLAUDE.md](CLAUDE.md) §3 for the exact commands.

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
