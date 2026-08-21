"""Host checkout and locked-down Docker verification for Fix Lab."""

from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import time


_REPO_NAME = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_PROTECTED = (".github/workflows/", ".env", ".git/", "CODEOWNERS")
MAX_PATCH_BYTES = 100_000
MAX_CHANGED_LINES = 400
MAX_CHANGED_FILES = 5
MAX_RECEIPT_CHARS = 12_000


class FixLabError(RuntimeError):
    pass


def _minimal_env() -> dict[str, str]:
    keys = ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP")
    env = {key: os.environ[key] for key in keys if os.environ.get(key)}
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1"})
    return env


def workspace_for(run_id: str) -> Path:
    root = Path(os.getenv("FIX_LAB_ROOT") or Path(__file__).resolve().parents[1] / ".fixlab")
    root = root.resolve()
    workspace = (root / "runs" / run_id / "repo").resolve()
    if root not in workspace.parents:
        raise FixLabError("invalid Fix Lab workspace")
    return workspace


def prepare_checkout(run_id: str, repo_name: str) -> tuple[Path, str]:
    if not _REPO_NAME.fullmatch(repo_name):
        raise FixLabError("repository must be owner/name")
    workspace = workspace_for(run_id)
    workspace.parent.mkdir(parents=True, exist_ok=True)
    if workspace.exists():
        raise FixLabError("Fix Lab workspace already exists")
    url = f"https://github.com/{repo_name}.git"
    result = subprocess.run(
        ["git", "clone", "--depth", "1", "--", url, str(workspace)],
        capture_output=True,
        text=True,
        timeout=120,
        shell=False,
        env=_minimal_env(),
    )
    if result.returncode:
        raise FixLabError(f"public checkout failed: {result.stderr[-500:]}")
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=workspace,
        capture_output=True,
        text=True,
        timeout=15,
        shell=False,
        env=_minimal_env(),
        check=True,
    ).stdout.strip()
    return workspace, sha


def patch_paths(patch: str) -> list[str]:
    if not patch.strip().startswith("diff --git "):
        raise FixLabError("model did not return a git unified diff")
    if len(patch.encode("utf-8")) > MAX_PATCH_BYTES:
        raise FixLabError("patch exceeds size limit")
    if "GIT binary patch" in patch or "Subproject commit" in patch:
        raise FixLabError("binary and submodule patches are forbidden")

    pairs = re.findall(r"^diff --git a/(.+?) b/(.+?)$", patch, re.MULTILINE)
    if not pairs or len(pairs) > MAX_CHANGED_FILES:
        raise FixLabError("patch changes an invalid number of files")
    paths: list[str] = []
    for before, after in pairs:
        if before != after:
            raise FixLabError("renames are not supported in Fix Lab")
        path = PurePosixPath(after)
        if path.is_absolute() or ".." in path.parts:
            raise FixLabError("patch path escapes the repository")
        normalized = path.as_posix()
        if normalized.startswith(_PROTECTED) or normalized in _PROTECTED:
            raise FixLabError(f"protected path cannot be modified: {normalized}")
        paths.append(normalized)
    changed_lines = sum(
        1 for line in patch.splitlines()
        if (line.startswith("+") and not line.startswith("+++"))
        or (line.startswith("-") and not line.startswith("---"))
    )
    if changed_lines > MAX_CHANGED_LINES:
        raise FixLabError("patch changes too many lines")
    return paths


def apply_patch(workspace: Path, patch: str, allowed_paths: set[str]) -> list[str]:
    paths = patch_paths(patch)
    if not set(paths).issubset(allowed_paths):
        unexpected = sorted(set(paths) - allowed_paths)
        raise FixLabError(f"patch touched files outside retrieved evidence: {unexpected}")
    patch_file = workspace.parent / "candidate.patch"
    patch_file.write_text(patch, encoding="utf-8")
    for extra in ("--check", None):
        args = ["git", "apply"]
        if extra:
            args.append(extra)
        args.append(str(patch_file))
        result = subprocess.run(
            args,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=30,
            shell=False,
            env=_minimal_env(),
        )
        if result.returncode:
            raise FixLabError(f"patch could not be applied: {result.stderr[-500:]}")
    return paths


def verification_commands(workspace: Path, changed_paths: list[str]) -> tuple[str, list[list[str]]]:
    python_change = any(PurePosixPath(path).suffix == ".py" for path in changed_paths)
    if python_change:
        target = "tests" if (workspace / "tests").is_dir() else "."
        return os.getenv("FIX_LAB_PYTHON_IMAGE", "repoguardian-fixlab-python:local"), [
            ["python", "-m", "pytest", target, "-q", "-p", "no:cacheprovider"]
        ]

    package_roots = []
    for path in changed_paths:
        parts = PurePosixPath(path).parts
        for depth in range(len(parts), -1, -1):
            root = workspace.joinpath(*parts[:depth])
            if (root / "package.json").exists():
                package_roots.append(PurePosixPath(*parts[:depth]).as_posix() or ".")
                break
    if package_roots:
        root = sorted(set(package_roots))[0]
        package = json.loads((workspace / root / "package.json").read_text(encoding="utf-8"))
        if "test" not in (package.get("scripts") or {}):
            raise FixLabError("changed package has no test script")
        return os.getenv("FIX_LAB_NODE_IMAGE", "node:22-bookworm-slim"), [
            ["npm", "--prefix", root, "test", "--", "--run"]
        ]
    raise FixLabError("no allowlisted verification command matches the changed files")


def verify_in_container(
    workspace: Path,
    image: str,
    commands: list[list[str]],
) -> list[dict]:
    inspected = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", image],
        capture_output=True,
        text=True,
        timeout=20,
        shell=False,
        env=_minimal_env(),
    )
    if inspected.returncode:
        raise FixLabError(
            f"verification image {image!r} is not installed; build the trusted Fix Lab image first"
        )
    image_digest = inspected.stdout.strip()
    receipts = []
    mount = f"type=bind,source={workspace},target=/workspace,readonly"
    for command in commands:
        docker_command = [
            "docker", "run", "--rm", "--pull", "never", "--network", "none",
            "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--pids-limit", "256", "--memory", "1g", "--cpus", "1",
            "--user", "65534:65534", "--env", "PYTHONDONTWRITEBYTECODE=1",
            "--mount", mount, "--workdir", "/workspace", image, *command,
        ]
        started = time.perf_counter()
        try:
            result = subprocess.run(
                docker_command,
                capture_output=True,
                text=True,
                timeout=180,
                shell=False,
                env=_minimal_env(),
            )
            exit_code = result.returncode
            stdout = result.stdout[-MAX_RECEIPT_CHARS:]
            stderr = result.stderr[-MAX_RECEIPT_CHARS:]
        except subprocess.TimeoutExpired as exc:
            exit_code = 124
            stdout = str(exc.stdout or "")[-MAX_RECEIPT_CHARS:]
            stderr = "verification timed out"
        receipts.append({
            "command": command,
            "exit_code": exit_code,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "stdout": stdout,
            "stderr": stderr,
            "containerized": True,
            "network_disabled": True,
            "image": image,
            "image_digest": image_digest,
        })
    return receipts
