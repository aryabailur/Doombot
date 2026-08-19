# scripts/ — operational scripts and demo insurance

**Owner:** Person A (Stream A) · **Branch prefix:** `feat/a-<slug>`

Read the root `CLAUDE.md` first. This file governs everything under
`scripts/`.

---

## 1. Purpose

`scripts/seed_demo.py` is **demo insurance**, not a nice-to-have. It exists
because two very real failure modes can happen at the exact moment you're
standing in front of judges:

1. **Groq rate-limits you.** The whole agent pipeline runs on
   `llama-3.3-70b-versatile`. A free-tier or shared rate limit hit mid-demo
   means the live investigation you just triggered hangs or errors, live,
   on screen.
2. **Venue wifi dies.** No GitHub API, no Groq API, nothing. This is a
   hackathon venue, not a data center — treat flaky wifi as a certainty, not
   a risk.

Either failure mode, without a fallback, turns a working demo into a dead
screen. `seed_demo.py` pre-populates the database with a complete, realistic
demo story so that if live investigation fails, you pivot to "let me show
you a completed investigation" without missing a beat — the dashboard reads
seeded data identically to live data, because it's the same SQLite tables
and the same `api/schemas.py` shapes.

---

## 2. What it seeds

Running `scripts/seed_demo.py` populates:

- **3 completed investigations**, each with a full, realistic
  `chain_steps` sequence (not a single stub step — the actual multi-step
  chain a real run would produce: fetch, retrieve-similar, classify,
  decide, act).
- **4 escalations** of varying severity (`low`, `medium`, `high`, and one
  more to show range), each tied to one of the seeded investigations.
- **7 health score points** for at least one repo, spaced out in time and
  forming a **visible trend** (not flat, not random noise) — the health
  dashboard chart should show a story (e.g. declining then recovering, or
  steadily improving) when you point at it.

All of this goes through the exact same `memory/repo.py` functions a real
investigation run would call (`create_investigation`, `insert_step`,
`create_escalation`, `record_health_score`) — no separate seed-only DB
writing path. That's what guarantees the seeded data round-trips through
the real API endpoints identically to live data.

---

## 3. The chain must tell the demo story

At least one seeded investigation must be the showcase case: an issue that
is flagged for **two independent reasons at once**, because that's what
makes the "agentic reasoning" visible instead of abstract.

**The required scenario:**

- The issue is a **duplicate** of issue `#412`, with a cosine similarity
  score of **0.91** against the retrieved match (surfaced as `Evidence` with
  `type="duplicate"`, `ref` pointing at `#412`, `score=0.91`).
- The issue **also** contains a **security concern**: an `API_KEY` value
  visible in a pasted traceback in the issue body (surfaced as `Evidence`
  with `type="security"`, a snippet showing the leaked-looking key
  redacted/truncated appropriately, high score).
- The combination drives an **`impact_score` of 87**.
- The final `decision` is **`ESCALATE`**, with a `decision_reason` that
  explicitly states both reasons (duplicate-with-high-confidence AND
  possible secret exposure), not just one.

This is the one investigation you walk judges through step-by-step, because
it demonstrates the chain doing two different kinds of reasoning
(similarity retrieval + pattern/security detection) and combining them into
a single, justified decision — which is the entire pitch of the project.

**Rule: seed data must be realistic, never lorem ipsum.** Judges read
whatever's on screen. A fake issue titled "Test issue 1" with body "lorem
ipsum dolor sit amet" instantly signals "this is fake" and undercuts the
demo's credibility, even though the underlying pipeline is real. Write real
titles, real bodies with real code-like content, real GitHub usernames
(fictional but plausible, e.g. `devuser42`, not `user1`), real timestamps
spaced realistically over days/weeks — not all created in the same second.

---

## 4. `DEMO_MODE` — canned LLM responses

Set `DEMO_MODE=1` to make the agent pipeline serve **canned LLM responses**
instead of calling Groq. This is the second half of demo insurance: even if
you trigger a *live* investigation during the demo (not just seeded data),
`DEMO_MODE=1` removes Groq's live-API dependency and its rate-limit risk
from that run, while still exercising the real graph, real MCP tool calls,
and real SQLite writes end-to-end.

`DEMO_MODE` is read by the agent/LLM call layer (`agents/`), not by
`scripts/seed_demo.py` itself — seeding writes directly to SQLite and never
calls Groq regardless of this flag. Document it here because it's part of
the same "protect the demo" strategy and judges/teammates will look for it
in this file.

---

## 5. Running it

```bash
python -m scripts.seed_demo
```

Always invoke as a module (`-m scripts.seed_demo`), matching the same
repo-root-on-`sys.path` reasoning as `mcp_server`'s `-m` invocation — do not
run `python scripts/seed_demo.py` directly.

Add a `--reset` flag that wipes existing seeded/live rows from the relevant
tables (`investigations`, `chain_steps`, `escalations`, `health_scores`)
before reseeding, so the script is safely re-runnable during rehearsal
without accumulating duplicate demo investigations:

```bash
python -m scripts.seed_demo --reset
```

Without `--reset`, running it twice should not be assumed safe — either
make investigation IDs stable/idempotent (same seed run overwrites the same
IDs) or clearly document that a second run without `--reset` adds a second
copy of the demo story.

---

## 6. Verification

```bash
python -m scripts.seed_demo --reset
```

Then confirm counts directly against SQLite:

```bash
python -c "
from memory.db import get_conn
c = get_conn()
for table in ('investigations', 'chain_steps', 'escalations', 'health_scores'):
    n = c.execute(f'select count(*) from {table}').fetchone()[0]
    print(table, n)
"
```

Expect: 3 investigations, an escalation-worthy multi-row `chain_steps` count
(several steps per investigation, not 1:1), 4 escalations, 7 health_scores.

Then hit it through the real API to confirm the round-trip:

```bash
curl http://localhost:8000/api/investigations
curl http://localhost:8000/api/escalations
curl http://localhost:8000/api/repos
```

Manually inspect the showcase investigation's detail response and confirm
both `Evidence` entries (`duplicate` @ 0.91, `security`) are present, and
`decision == "ESCALATE"` with `impact_score == 87`.

---

## 7. Task breakdown

| Task | File(s) | Branch |
|---|---|---|
| Seed script core: 3 investigations + chains via memory/repo.py | `scripts/seed_demo.py` | `feat/a-scripts-seed-core` |
| Showcase duplicate+security investigation (impact 87, ESCALATE) | `scripts/seed_demo.py` | `feat/a-scripts-seed-showcase` |
| 4 escalations, varying severity | `scripts/seed_demo.py` | `feat/a-scripts-seed-escalations` |
| 7 health score points forming a trend | `scripts/seed_demo.py` | `feat/a-scripts-seed-health` |
| `--reset` flag | `scripts/seed_demo.py` | `feat/a-scripts-seed-reset` |

---

## Definition of done

- [ ] `python -m scripts.seed_demo` runs clean, no errors
- [ ] `--reset` flag wipes prior seeded rows before reseeding
- [ ] 3 completed investigations exist, each with a realistic multi-step chain
- [ ] 4 escalations exist with varying severity
- [ ] 7 health score points exist for at least one repo, forming a visible trend (not flat/random)
- [ ] The showcase investigation has both a `duplicate` evidence entry (ref `#412`, score `0.91`) and a `security` evidence entry
- [ ] The showcase investigation has `impact_score == 87` and `decision == "ESCALATE"`
- [ ] No lorem-ipsum, placeholder, or `"Test 1"`-style content anywhere in seeded data
- [ ] Seeded data round-trips correctly through `GET /api/investigations`, `/api/escalations`, `/api/repos`
- [ ] `DEMO_MODE=1` documented as the companion flag for live-but-safe demo runs
