#!/usr/bin/env bash
#
# End-to-end smoke test for Doombot + RepoGuardian Lens.
#
# Verifies every layer that can be checked from a terminal: credentials, the
# MCP surface, the RAG index, the triage graph, the REST contract, and the
# extension's build and unit tests. The browser-only checks (the Lens panel
# itself) are listed at the end for you to walk through by hand.
#
#   ./scripts/smoke_test.sh                      # against aryabailur/Doombot#4
#   ./scripts/smoke_test.sh owner/repo 12        # against another issue
#
# Exits non-zero if any automated check fails.

set -uo pipefail

REPO="${1:-aryabailur/Doombot}"
ISSUE="${2:-4}"
API="${API:-http://localhost:8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/.venv/bin/python"

pass=0
fail=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
info() { printf '        %s\n' "$1"; }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

cd "$ROOT" || exit 1

# ---------------------------------------------------------------- environment
head "1. Environment"

if [ -x "$PY" ]; then
  ok "venv interpreter present ($("$PY" --version 2>&1))"
else
  bad "no venv at .venv — run: uv venv --python 3.14 .venv"
  echo; echo "Cannot continue without the venv."; exit 1
fi

# A bare `python` must not be required anywhere: macOS ships only python3, and
# the MCP subprocess used to hardcode it.
if grep -rqs 'command="python"' agents/ mcp_server/; then
  bad 'a hardcoded command="python" is back — MCP spawn will fail on macOS'
  grep -rns 'command="python"' agents/ mcp_server/ | sed 's/^/        /'
else
  ok 'no hardcoded command="python" (MCP spawns via sys.executable)'
fi

# mcp 2.0 renamed FastMCP -> MCPServer and dropped mcp.server.fastmcp.
mcp_ver="$("$PY" -c 'import importlib.metadata as m; print(m.version("mcp"))' 2>/dev/null)"
case "$mcp_ver" in
  1.*) ok "mcp pinned to 1.x ($mcp_ver)" ;;
  *)   bad "mcp is $mcp_ver — 2.x removes mcp.server.fastmcp; run: uv pip install 'mcp>=1.28,<2'" ;;
esac

# ---------------------------------------------------------------- credentials
head "2. Credentials"

"$PY" - <<'PY'
import os, sys
from dotenv import load_dotenv
load_dotenv(".env")
missing = [k for k in ("GITHUB_TOKEN", "GROQ_API_KEY") if not os.getenv(k)]
sys.exit(1 if missing else 0)
PY
if [ $? -eq 0 ]; then
  ok "GITHUB_TOKEN and GROQ_API_KEY set in .env"
else
  bad "a credential is empty in .env — live triage will fail"
fi

if "$PY" -c "
from dotenv import load_dotenv; load_dotenv('.env')
from mcp_server.github_client import get_issue
get_issue('$REPO', $ISSUE)
" >/dev/null 2>&1; then
  ok "GitHub token reads $REPO#$ISSUE"
else
  bad "GitHub token cannot read $REPO#$ISSUE"
fi

if "$PY" -c "
from dotenv import load_dotenv; load_dotenv('.env')
import os
from langchain_groq import ChatGroq
ChatGroq(model=os.getenv('GROQ_MODEL','openai/gpt-oss-120b')).invoke('say ok')
" >/dev/null 2>&1; then
  ok "Groq key answers a live prompt"
else
  bad "Groq key rejected (or rate-limited: free tier is 8k tokens/min)"
fi

# ---------------------------------------------------------------- MCP surface
head "3. MCP server (F12)"

tools="$("$PY" - <<'PY' 2>/dev/null
import asyncio, sys
from dotenv import load_dotenv; load_dotenv(".env")
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    params = StdioServerParameters(command=sys.executable, args=["-m", "mcp_server.server"])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print("TOOLCOUNT", len((await session.list_tools()).tools))

asyncio.run(main())
PY
)"
tools="$(printf '%s' "$tools" | awk '/^TOOLCOUNT/{print $2}')"
if [ "${tools:-0}" -ge 9 ] 2>/dev/null; then
  ok "MCP stdio session works, $tools tools registered"
else
  bad "MCP server did not start or registered no tools"
fi

# ---------------------------------------------------------------- RAG index
head "4. RAG index (F03/F06)"

indexed="$("$PY" - <<PY 2>/dev/null
import os, chromadb
from dotenv import load_dotenv; load_dotenv(".env")
name = "$REPO".replace("/", "-") + "-issues"
client = chromadb.PersistentClient(path=os.getenv("CHROMA_DIR", "./chroma_db"))
have = {c.name for c in client.list_collections()}
print(client.get_collection(name).count() if name in have else 0)
PY
)"
if [ "${indexed:-0}" -gt 0 ] 2>/dev/null; then
  ok "$indexed issues indexed for $REPO"
else
  bad "no issues indexed — duplicate detection returns nothing"
  info "fix: $PY app.py index $REPO"
fi

# ---------------------------------------------------------------- triage graph
head "5. Triage graph (F01/F02/F04/F06/F07)"

info "running the full graph on $REPO#$ISSUE (~15s, DEMO_MODE=1, no GitHub writes)"
graph_out="$(DEMO_MODE=1 "$PY" app.py triage "$REPO" "$ISSUE" 2>&1)"

steps_ok="$(printf '%s' "$graph_out" | grep -c '\[OK\]')"
if [ "$steps_ok" -ge 7 ]; then
  ok "all $steps_ok graph nodes completed"
else
  bad "only $steps_ok nodes completed (expected 7)"
  printf '%s\n' "$graph_out" | grep -E '\[!!\]|Error|error' | head -3 | sed 's/^/        /'
fi

if printf '%s' "$graph_out" | grep -q 'DECISION'; then
  ok "decision reached: $(printf '%s' "$graph_out" | grep 'DECISION' | sed 's/.*DECISION *: *//')"
else
  bad "no decision recorded"
fi

if printf '%s' "$graph_out" | grep -q "duplicates : \[" ; then
  ok "duplicate detection returned matches"
else
  info "duplicates: none found (correct if this issue has no near-neighbours)"
fi

# ---------------------------------------------------------------- REST + CORS
head "6. REST API and CORS"

if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$API/api/health")" = "200" ]; then
  ok "$API/api/health returns 200"
else
  bad "API not responding at $API — start it: .venv/bin/uvicorn api.main:app --port 8000"
fi

origin="$(curl -s -i -m 5 -X OPTIONS "$API/api/investigations" \
  -H 'Origin: https://github.com' \
  -H 'Access-Control-Request-Method: POST' 2>/dev/null \
  | tr -d '\r' | awk 'tolower($1)=="access-control-allow-origin:"{print $2}')"
if [ "$origin" = "https://github.com" ]; then
  ok "CORS allows https://github.com (the Lens content script origin)"
else
  bad "CORS does not allow github.com — the extension's backend mode will be blocked"
fi

id="$(curl -s -m 10 -X POST "$API/api/investigations" \
  -H 'Content-Type: application/json' \
  -d "{\"repo_name\":\"$REPO\",\"kind\":\"issue\",\"number\":$ISSUE}" \
  | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("investigation_id",""))' 2>/dev/null)"

if [ -n "$id" ]; then
  ok "POST /api/investigations accepted (id ${id:0:8})"
  info "polling for completion (typically ~15s)"
  state=""
  for _ in $(seq 1 40); do
    state="$(curl -s -m 5 "$API/api/investigations/$id" | "$PY" -c '
import json, sys
try:
    print(json.load(sys.stdin).get("status", ""))
except Exception:
    print("")
' 2>/dev/null)"
    [ "$state" = "done" ] && break
    sleep 2
  done

  if [ "$state" != "done" ]; then
    bad "investigation did not reach status=done within 80s (last: ${state:-no response})"
  else
    # `python -` with a heredoc cannot also read piped stdin: the heredoc
    # supplies the *script*, so the piped JSON would be parsed as source.
    # Save the body to a file and pass it as an argument instead.
    curl -s -m 5 "$API/api/investigations/$id" > /tmp/dbt_run.json
    verdict="$("$PY" scripts/_check_run.py /tmp/dbt_run.json 2>&1 | tail -1)"

    case "$verdict" in
      OK*) ok "${verdict#OK }" ;;
      *)   bad "${verdict#NO }" ;;
    esac
  fi
else
  bad "POST /api/investigations did not return an id"
fi

# ---------------------------------------------------------------- test suites
head "7. Test suites"

if "$PY" -m pytest tests/ -q >/tmp/dbt_pytest.log 2>&1; then
  ok "backend pytest: $(tail -1 /tmp/dbt_pytest.log)"
else
  bad "backend pytest failed: $(tail -1 /tmp/dbt_pytest.log)"
fi

if (cd repoguardian-lens && npm test >/tmp/dbt_vitest.log 2>&1); then
  ok "extension vitest: $(sed 's/\x1b\[[0-9;]*m//g' /tmp/dbt_vitest.log | awk '/Tests/{$1=$1; print; exit}')"
else
  bad "extension vitest failed"
  grep -E '✕|FAIL' /tmp/dbt_vitest.log | head -3 | sed 's/^/        /'
fi

if (cd repoguardian-lens && npm run typecheck >/dev/null 2>&1); then
  ok "extension typecheck clean"
else
  bad "extension typecheck failed"
fi

if (cd repoguardian-lens && npm run lint >/dev/null 2>&1); then
  ok "extension lint clean"
else
  bad "extension lint failed"
fi

if (cd repoguardian-lens && npm run build >/dev/null 2>&1) && [ -f repoguardian-lens/dist/manifest.json ]; then
  ok "extension builds to dist/"
else
  bad "extension build failed"
fi

# ---------------------------------------------------------- agentic monitoring
head "8. Autonomous monitoring (F01, the compulsory feature)"

watched="$(grep -E '^DOOMBOT_MONITOR_REPOS=.+' .env 2>/dev/null | cut -d= -f2-)"
if [ -n "$watched" ]; then
  ok "monitoring enabled for: $watched"
  # The agent investigates on its own, so its work is already in SQLite.
  auto="$(curl -s -m 5 "$API/api/investigations" | "$PY" -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    rows = []
decided = {r["decision"] for r in rows if r.get("decision")}
print(len(rows), ",".join(sorted(decided)))
' 2>/dev/null)"
  count="${auto%% *}"
  kinds="${auto#* }"
  if [ "${count:-0}" -gt 0 ] 2>/dev/null; then
    ok "$count investigations recorded; decisions seen: ${kinds:-none}"
  else
    bad "monitoring on but no investigations recorded yet — allow one interval"
  fi
  case "$kinds" in
    *,*) ok "decisions are differentiated (selective escalation, not flag-everything)" ;;
    *)   info "only one decision type so far: $kinds" ;;
  esac
else
  info "monitoring off (DOOMBOT_MONITOR_REPOS empty) — the agent will not self-trigger"
fi

# ---------------------------------------------------------------- safety
head "9. Safety posture"

if [ "$(grep -c '^DOOMBOT_MONITOR_REPOS=$' .env 2>/dev/null)" = "1" ]; then
  ok "autonomous monitoring off (no repo named)"
else
  info "DOOMBOT_MONITOR_REPOS is set — the agent will comment on real repos unless DEMO_MODE=1"
fi

if grep -q '^DEMO_MODE=1' .env 2>/dev/null; then
  ok "DEMO_MODE=1 — nothing is written to GitHub"
else
  info "DEMO_MODE is not 1 — approved actions WILL write to GitHub"
fi

# ---------------------------------------------------------------- summary
head "Summary"
printf '  %d passed, %d failed\n' "$pass" "$fail"

cat <<'MANUAL'

  Browser checks (cannot be automated from here):

    1. chrome://extensions -> Load unpacked -> repoguardian-lens/dist
    2. Open https://github.com/acme/payments-api/issues/482  (404 is expected)
       -> Demo mode: panel shows acme/payments-api, health 82,
          Investigate ends at ESCALATE 94%
    3. Switch to LIVE GITHUB on a real repo
       -> header shows the real repo, real issue titles, uneven confidences,
          and no amber "Showing demo data" banner
    4. Options -> RepoGuardian backend = http://localhost:8000
       -> live mode now routes through Groq; factors read
          "Security-sensitive terms: ...", "Related to #N at NN%"
    5. Cmd/Ctrl+G -> "What should I care about?" -> evidence-backed answers
    6. Toggle back to DEMO REPOSITORY -> scripted 94/81/76 returns

MANUAL

[ "$fail" -eq 0 ] || exit 1
