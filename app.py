"""Doombot CLI — run a graph without the API layer.

Three commands:

    python app.py index  owner/repo            index issues + code into Chroma
    python app.py triage owner/repo 42         investigate an issue
    python app.py review owner/repo 7          review a pull request

The API (Stream A) is the real entrypoint; this exists so the agent can be
driven, demoed, and debugged before the API exists, and so a failure can be
isolated to the graph rather than the transport.

Set DEMO_MODE=1 to run the triage graph without writing anything to GitHub.
"""

import argparse
import asyncio
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv()


def _fmt(ms: int) -> str:
    """840ms / 1.2s — matches the dashboard's duration format."""
    return f"{ms}ms" if ms < 1000 else f"{ms / 1000:.1f}s"


async def _run_streaming(graph, state: dict) -> dict:
    """Run a graph, printing each step as it completes.

    Consumes the same custom stream the API forwards to the WebSocket, so what
    prints here is exactly what the dashboard will render.
    """
    async for mode, chunk in graph.astream(state, stream_mode=["custom", "updates"]):
        if mode == "custom" and chunk["type"] == "step.completed":
            step = chunk["data"]
            mark = {"done": "OK", "error": "!!"}.get(step["status"], "..")
            print(f"  [{mark}] {step['seq']} {step['title']:<34} {_fmt(step['duration_ms']):>7}")
            if step["status"] == "error":
                print(f"        {step['output_summary']}")
    return await graph.ainvoke(state)


def cmd_index(args) -> int:
    from rag.embedder import index_issues, index_repo_files

    print(f"indexing {args.repo}")
    issues = index_issues(args.repo, state="all", limit=args.limit)
    print(f"  {issues} issues -> {args.repo.replace('/', '-')}-issues")
    if args.code:
        chunks = index_repo_files(args.repo)
        print(f"  {chunks} file chunks -> {args.repo.replace('/', '-')}-code")
    else:
        print("  (skipped code files; pass --code to include them)")
    return 0


def cmd_triage(args) -> int:
    from agents.triage_graph import issue_app

    if os.getenv("DEMO_MODE") == "1":
        # ASCII only in printed output: the Windows console defaults to cp1252
        # and renders an em-dash as a replacement char, which looks broken on
        # a projector.
        print("DEMO_MODE=1 - nothing will be written to GitHub\n")

    final = asyncio.run(_run_streaming(issue_app, {
        "repo_name": args.repo,
        "issue_number": args.number,
        "investigation_id": str(uuid.uuid4()),
        "chain": [],
    }))

    dupes = final.get("duplicates") or []
    print()
    print(f"  duplicates : {[(d['number'], round(d['score'], 2), d['relation']) for d in dupes] or 'none'}")
    print(f"  security   : {[f['keyword'] for f in final.get('security_findings') or []] or 'none'}")
    print(f"  impact     : {final.get('impact_score', 0)}/100")
    print(f"  labels     : {final.get('labels') or 'none'}"
          f" (suggested={final.get('labels_suggested')})")
    decision = final.get("decision") or {}
    print(f"  DECISION   : {decision.get('action', '?').upper()}")
    print(f"               {decision.get('reason', '')}")
    if decision.get("applied"):
        print(f"  applied    : {decision['applied']}")
    return 0


def cmd_review(args) -> int:
    from agents.orchestrator import app as pr_app

    result = pr_app.invoke({
        "repo_name": args.repo,
        "pr_number": args.number,
        "pr_metadata": {},
        "diff_files": [],
        "review_metadata": [],
        "test_metadata": "",
        "summary_metadata": "",
    })
    print(result.get("summary_metadata", ""))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="doombot", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_index = sub.add_parser("index", help="index a repo's issues (and optionally code) into Chroma")
    p_index.add_argument("repo")
    p_index.add_argument("--limit", type=int, default=200, help="max issues to index")
    p_index.add_argument("--code", action="store_true",
                         help="also index source files (slow; only needed for PR review)")
    p_index.set_defaults(func=cmd_index)

    p_triage = sub.add_parser("triage", help="investigate an issue")
    p_triage.add_argument("repo")
    p_triage.add_argument("number", type=int)
    p_triage.set_defaults(func=cmd_triage)

    p_review = sub.add_parser("review", help="review a pull request")
    p_review.add_argument("repo")
    p_review.add_argument("number", type=int)
    p_review.set_defaults(func=cmd_review)

    args = parser.parse_args()

    # Fail on missing credentials here rather than deep inside an SDK, where
    # it surfaces as an opaque auth error three frames into httpx.
    missing = [k for k in ("GITHUB_TOKEN", "GROQ_API_KEY") if not os.getenv(k)]
    if missing:
        print(f"missing in .env: {', '.join(missing)}", file=sys.stderr)
        print("copy .env.example to .env and fill them in", file=sys.stderr)
        return 1

    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
