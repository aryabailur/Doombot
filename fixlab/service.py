"""Orchestrate one non-publishing Fix Lab run."""

import asyncio

from fixlab.generator import generate_patch
from fixlab.sandbox import (
    FixLabError,
    apply_patch,
    prepare_checkout,
    verification_commands,
    verify_in_container,
)
from memory import repo


def candidate_paths(investigation_id: str) -> list[str]:
    paths = []
    for step in repo.get_steps(investigation_id):
        if step.get("name") != "code_investigator":
            continue
        for evidence in step.get("evidence") or []:
            if evidence.get("type") != "file":
                continue
            ref = str(evidence.get("ref") or "")
            path, separator, line = ref.rpartition(":")
            if not separator or not line.isdigit():
                path = ref
            if path and path not in paths:
                paths.append(path)
    return paths[:4]


async def run_fix(run_id: str) -> None:
    """Generate, apply, and verify a candidate; never publish it."""
    run = repo.get_fix_run(run_id)
    if not run:
        return
    paths = candidate_paths(run["investigation_id"])
    if not paths:
        repo.update_fix_run(run_id, "failed", error="No grounded code candidates are available.")
        return
    try:
        repo.update_fix_run(run_id, "preparing")
        workspace, base_sha = await asyncio.to_thread(
            prepare_checkout, run_id, run["repo_name"]
        )
        repo.update_fix_run(run_id, "generating", base_sha=base_sha)
        generated = await asyncio.to_thread(
            generate_patch, run["repo_name"], run["issue_number"], paths
        )
        repo.update_fix_run(
            run_id,
            "generating",
            summary=generated["summary"],
            patch_diff=generated["patch"],
        )
        changed = await asyncio.to_thread(
            apply_patch, workspace, generated["patch"], set(paths)
        )
        image, commands = verification_commands(workspace, changed)
        repo.update_fix_run(
            run_id,
            "verifying",
            summary=generated["summary"],
            patch_diff=generated["patch"],
            commands=commands,
        )
        receipts = await asyncio.to_thread(
            verify_in_container, workspace, image, commands
        )
        passed = bool(receipts) and all(item["exit_code"] == 0 for item in receipts)
        repo.update_fix_run(
            run_id,
            "proposed" if passed else "failed",
            receipts=receipts,
            error=None if passed else "Candidate patch did not pass isolated verification.",
        )
    except (FixLabError, ValueError, OSError, RuntimeError) as exc:
        repo.update_fix_run(run_id, "failed", error=str(exc)[:1000])
