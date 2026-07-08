from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from runner_inputs import RunnerInputError, resolve_run_dir


@dataclass(frozen=True, slots=True)
class ParsedRunnerArgs:
    workflow_path: Path
    run_dir_arg: str | None
    fresh_run: bool
    stop_after_seed: bool
    opencode_url: str
    opencode_host: str
    opencode_port: int
    no_start_opencode: bool
    agent_timeout_sec: float


@dataclass(frozen=True, slots=True)
class RunnerArgs:
    workflow_path: Path
    run_dir: Path
    fresh_run: bool
    stop_after_seed: bool
    opencode_url: str
    opencode_host: str
    opencode_port: int
    no_start_opencode: bool
    agent_timeout_sec: float


@dataclass(frozen=True, slots=True)
class ReplayArgs:
    workflow_path: Path
    run_dir: Path
    mode: str
    stage: str | None
    gate: str | None
    opencode_url: str
    opencode_host: str
    opencode_port: int
    no_start_opencode: bool
    agent_timeout_sec: float


def parse_args(*, workflow_default: Path, opencode_url_default: str) -> ParsedRunnerArgs:
    parser = argparse.ArgumentParser(description="Run a workflow with OpenCode HTTP sessions")
    parser.add_argument("--workflow", default=str(workflow_default))
    parser.add_argument("--run-dir", default=None, help="Run directory. If omitted, derive from runtime.runDirectory.deriveFromInput and the workflow input artifact.")
    parser.add_argument("--fresh-run", action="store_true", help="Delete any existing run directory before seeding a new run")
    parser.add_argument("--stop-after-seed", action="store_true", help="Seed the run directory and exit without starting OpenCode")
    parser.add_argument("--opencode-url", default=opencode_url_default)
    parser.add_argument("--opencode-host", default="127.0.0.1")
    parser.add_argument("--opencode-port", type=int, default=5096)
    parser.add_argument("--no-start-opencode", action="store_true", help="Require an already running opencode serve process")
    parser.add_argument("--agent-timeout-sec", type=float, default=120.0)
    parsed = parser.parse_args()
    return ParsedRunnerArgs(
        workflow_path=Path(parsed.workflow).resolve(),
        run_dir_arg=parsed.run_dir,
        fresh_run=bool(parsed.fresh_run),
        stop_after_seed=bool(parsed.stop_after_seed),
        opencode_url=parsed.opencode_url,
        opencode_host=parsed.opencode_host,
        opencode_port=int(parsed.opencode_port),
        no_start_opencode=bool(parsed.no_start_opencode),
        agent_timeout_sec=float(parsed.agent_timeout_sec),
    )


def resolve_runner_args(
    parsed: ParsedRunnerArgs,
    *,
    repo_root: Path,
    run_root: Path,
    derive_from_input: str,
    workflow_root: Path,
    input_artifact: str,
) -> RunnerArgs:
    try:
        run_dir = resolve_run_dir(
            repo_root=repo_root,
            run_root=run_root,
            run_dir_arg=parsed.run_dir_arg,
            derive_from_input=derive_from_input,
            workflow_root=workflow_root,
            input_artifact=input_artifact,
        )
    except RunnerInputError as exc:
        raise SystemExit(str(exc)) from exc
    return RunnerArgs(
        workflow_path=parsed.workflow_path,
        run_dir=run_dir,
        fresh_run=parsed.fresh_run,
        stop_after_seed=parsed.stop_after_seed,
        opencode_url=parsed.opencode_url,
        opencode_host=parsed.opencode_host,
        opencode_port=parsed.opencode_port,
        no_start_opencode=parsed.no_start_opencode,
        agent_timeout_sec=parsed.agent_timeout_sec,
    )


def parse_replay_args(*, workflow_default: Path, opencode_url_default: str) -> ReplayArgs:
    parser = argparse.ArgumentParser(description="Inspect or replay workflow stages and gates")
    parser.add_argument("--workflow", default=str(workflow_default))
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--mode", choices=["inspect", "stage", "gate", "sessions"], default="inspect")
    parser.add_argument("--stage", default=None)
    parser.add_argument("--gate", default=None)
    parser.add_argument("--opencode-url", default=opencode_url_default)
    parser.add_argument("--opencode-host", default="127.0.0.1")
    parser.add_argument("--opencode-port", type=int, default=5096)
    parser.add_argument("--no-start-opencode", action="store_true")
    parser.add_argument("--agent-timeout-sec", type=float, default=120.0)
    parsed = parser.parse_args()
    if parsed.mode == "stage" and not parsed.stage:
        parser.error("--stage is required when --mode stage")
    if parsed.mode == "gate" and not parsed.gate:
        parser.error("--gate is required when --mode gate")
    return ReplayArgs(
        workflow_path=Path(parsed.workflow).resolve(),
        run_dir=Path(parsed.run_dir).resolve(),
        mode=parsed.mode,
        stage=parsed.stage,
        gate=parsed.gate,
        opencode_url=parsed.opencode_url,
        opencode_host=parsed.opencode_host,
        opencode_port=int(parsed.opencode_port),
        no_start_opencode=bool(parsed.no_start_opencode),
        agent_timeout_sec=float(parsed.agent_timeout_sec),
    )
