from __future__ import annotations

import json
import os
from pathlib import Path

from contracts import load_bundle_contract
from opencode_http import OpencodeHttpClient, OpencodeHttpConfig
from opencode_server import ensure_server, stop_server, write_server_state
from runner import DEFAULT_OPENCODE_URL, DEFAULT_WORKFLOW, REPO_ROOT, run_gate, run_stage
from runner_cli import parse_replay_args
from session_store import SessionStore


def main() -> int:
    args = parse_replay_args(workflow_default=DEFAULT_WORKFLOW, opencode_url_default=DEFAULT_OPENCODE_URL)
    contract = load_bundle_contract(args.workflow_path)
    if args.mode == "inspect":
        print(inspect_run_directory(args.run_dir))
        return 0
    if args.mode == "sessions":
        print(print_active_session_ids(args.run_dir))
        return 0
    if args.mode == "gate":
        return run_gate(run_dir=args.run_dir, gate=args.gate or "", contract=contract).exit_code
    store = SessionStore(args.run_dir)
    server = ensure_server(
        base_url=args.opencode_url,
        host=args.opencode_host,
        port=args.opencode_port,
        no_start=args.no_start_opencode,
        timeout_sec=args.agent_timeout_sec,
        run_dir=args.run_dir,
        workdir=REPO_ROOT,
        username=os.environ.get("OPENCODE_SERVER_USERNAME"),
        password=os.environ.get("OPENCODE_SERVER_PASSWORD"),
    )
    write_server_state(args.run_dir / "artifacts" / "opencode-server.json", server)
    client = OpencodeHttpClient(
        OpencodeHttpConfig(
            server.base_url,
            args.agent_timeout_sec,
            os.environ.get("OPENCODE_SERVER_USERNAME"),
            os.environ.get("OPENCODE_SERVER_PASSWORD"),
        )
    )
    try:
        run_stage(
            run_dir=args.run_dir,
            stage=args.stage or "",
            server_url=server.base_url,
            agent_timeout_sec=args.agent_timeout_sec,
            contract=contract,
            store=store,
            client=client,
        )
        return 0
    finally:
        stop_server(server)


def inspect_run_directory(run_dir: Path) -> str:
    artifacts_dir = run_dir / "artifacts"
    input_path = artifacts_dir / "input.json"
    session_path = artifacts_dir / "opencode-sessions.json"
    attach_path = artifacts_dir / "opencode-attach-commands.txt"
    runtime_state = {}
    sessions = {}
    if session_path.is_file():
        payload = json.loads(session_path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            runtime_state = payload.get("runtimeState", {})
            sessions = payload.get("sessions", {})
    return "\n".join(
        [
            f"runDirectory={run_dir}",
            f"inputArtifact={input_path}",
            f"attachGuide={attach_path}",
            f"runtimeState={json.dumps(runtime_state, ensure_ascii=False, sort_keys=True)}",
            f"sessions={json.dumps(sessions, ensure_ascii=False, sort_keys=True)}",
        ]
    )


def print_active_session_ids(run_dir: Path) -> str:
    session_path = run_dir / "artifacts" / "opencode-sessions.json"
    if not session_path.is_file():
        return ""
    payload = json.loads(session_path.read_text(encoding="utf-8"))
    sessions = payload.get("sessions", {}) if isinstance(payload, dict) else {}
    if not isinstance(sessions, dict):
        return ""
    lines: list[str] = []
    for stage in sorted(sessions):
        item = sessions.get(stage)
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            lines.append(f"{stage}={item['id']}")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
