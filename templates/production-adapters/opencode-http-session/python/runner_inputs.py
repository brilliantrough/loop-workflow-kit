from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any


class RunnerInputError(RuntimeError):
    pass


def resolve_run_dir(
    *,
    repo_root: Path,
    run_root: Path,
    run_dir_arg: str | None,
    derive_from_input: str,
    workflow_root: Path,
    input_artifact: str,
) -> Path:
    if run_dir_arg is not None:
        return Path(run_dir_arg).resolve()
    payload = read_json_object(workflow_root / input_artifact)
    fields = [field.strip() for field in derive_from_input.split("+") if field.strip()]
    if not fields:
        raise RunnerInputError("runtime.runDirectory.deriveFromInput must name at least one input field")
    slug = "--".join(sanitize_segment(_required_string(payload, field)) for field in fields)
    return (run_root / slug).resolve()


def prepare_run_directory(
    *,
    run_dir: Path,
    run_root: Path,
    workflow_root: Path,
    seed_paths: tuple[Path, ...],
    marker_name: str,
    fresh_run: bool,
) -> None:
    if fresh_run and run_dir.exists():
        ensure_safe_fresh_run(run_dir=run_dir, run_root=run_root, marker_name=marker_name)
        shutil.rmtree(run_dir)
    for relative_path in seed_paths:
        source_path = workflow_root / relative_path
        target_path = run_dir / relative_path
        if not source_path.exists():
            raise RunnerInputError(f"seed artifact does not exist: {source_path}")
        if not target_path.exists():
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)
    write_marker(run_dir, marker_name=marker_name)


def ensure_safe_fresh_run(*, run_dir: Path, run_root: Path, marker_name: str) -> None:
    marker_path = run_dir / marker_name
    try:
        run_dir.relative_to(run_root.resolve())
        return
    except ValueError:
        pass
    if marker_path.is_file():
        return
    raise RunnerInputError(f"refusing --fresh-run outside canonical run root without runner marker: {run_dir}")


def write_marker(run_dir: Path, *, marker_name: str) -> None:
    marker_path = run_dir / marker_name
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text("opencode-http-session\n", encoding="utf-8")


def read_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RunnerInputError(f"expected JSON object: {path}")
    return dict(payload)


def sanitize_segment(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    return normalized.strip("-._") or "run"


def _required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RunnerInputError(f"input artifact is missing non-empty string field: {key}")
    return value
