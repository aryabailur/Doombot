"""Report whether an investigation JSON body represents a clean run.

Used by scripts/smoke_test.sh. Kept as a file rather than an inline heredoc
because `python -` cannot read a heredoc script and piped stdin at once -- the
heredoc claims stdin, so the piped JSON would be parsed as source.

Prints one line: "OK <summary>" or "NO <reason>".
"""

import json
import sys

with open(sys.argv[1]) as handle:
    run = json.load(handle)

steps = run.get("steps", [])
errored = [step for step in steps if step["status"] == "error"]
decision = run.get("decision")

if decision and decision != "error" and not errored:
    print(f"OK API replay: {decision} at {run.get('confidence')} over {len(steps)} steps")
else:
    detail = "; ".join(
        f"{step['name']}: {step['output_summary'][:70]}" for step in errored[:2]
    )
    print(f"NO decision={decision}, {len(errored)} step(s) errored. {detail}".rstrip())
