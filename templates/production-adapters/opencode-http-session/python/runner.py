from __future__ import annotations

import hashlib
import json
import os
import shlex
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from contracts import GateContract, WorkflowBundleContract, load_bundle_contract
from opencode_http import OpencodeHttpClient, OpencodeHttpConfig, OpencodeHttpError
from opencode_server import ensure_server, stop_server, write_server_state
from prompt_assembly import clear_stage_outputs, ensure_stage_outputs, render_prompt
from runner_cli import parse_args, resolve_runner_args
from runner_inputs import prepare_run_directory
from session_store import SessionRecord, SessionStore


WORKFLOW_ROOT: Final = Path(__file__).resolve().parent
REPO_ROOT: Final = WORKFLOW_ROOT.parents[1]
DEFAULT_WORKFLOW: Final = WORKFLOW_ROOT / "workflow.yml"
DEFAULT_OPENCODE_URL: Final = "http://127.0.0.1:5096"
MAX_REVIEW_ATTEMPTS: Final = 2
STAGE_POLL_INTERVAL_SEC: Final = 0.25
STAGE_HARD_TIMEOUT_MULTIPLIER: Final = 4.0
OPEN_ASSISTANT_MAX_WAIT_SEC: Final = 3600.0
ATTACH_GUIDE_FILENAME: Final = "opencode-attach-commands.txt"


@dataclass(frozen=True, slots=True)
class GateResult:
    label: str
    exit_code: int

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


@dataclass(frozen=True, slots=True)
class StageWaitObservation:
    messages_supported: bool
    assistant_started: bool
    assistant_completed: bool
    open_assistant: bool
    outputs_complete: bool
    message_fingerprint: str | None
    output_fingerprint: tuple[tuple[str, bool, int | None], ...]
    missing_outputs: tuple[str, ...]


def main() -> int:
    parsed = parse_args(workflow_default=DEFAULT_WORKFLOW, opencode_url_default=DEFAULT_OPENCODE_URL)
    contract = load_bundle_contract(parsed.workflow_path)
    run_root = (REPO_ROOT / contract.runtime.run_directory.root).resolve()
    args = resolve_runner_args(
        parsed,
        repo_root=REPO_ROOT,
        run_root=run_root,
        derive_from_input=contract.runtime.run_directory.derive_from_input,
        workflow_root=contract.workflow_root,
        input_artifact=contract.manifest.run.input_artifact,
    )
    prepare_run_directory(
        run_dir=args.run_dir,
        run_root=run_root,
        workflow_root=contract.workflow_root,
        seed_paths=tuple(Path(path) for path in contract.manifest.run.seed_artifacts),
        marker_name=contract.runtime.run_directory.fresh_run_marker,
        fresh_run=args.fresh_run,
    )
    if args.stop_after_seed:
        return 0
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
    ensure_workflow_sessions(run_dir=args.run_dir, contract=contract, store=store, client=client)
    print_observer_summary(run_dir=args.run_dir, server_url=server.base_url, contract=contract, store=store)
    try:
        return run_workflow(
            run_dir=args.run_dir,
            server_url=server.base_url,
            agent_timeout_sec=args.agent_timeout_sec,
            contract=contract,
            store=store,
            client=client,
        )
    finally:
        stop_server(server)


def run_workflow(
    *,
    run_dir: Path,
    server_url: str,
    agent_timeout_sec: float,
    contract: WorkflowBundleContract,
    store: SessionStore,
    client: OpencodeHttpClient,
) -> int:
    current = contract.entry
    review_attempts = 0
    for _ in range(256):
        if current in contract.manifest.stages:
            stage_contract = contract.manifest.stages[current]
            run_stage(
                run_dir=run_dir,
                stage=current,
                server_url=server_url,
                agent_timeout_sec=agent_timeout_sec,
                contract=contract,
                store=store,
                client=client,
            )
            next_node = stage_contract.routing.on_success
            if _stage_controls_decision(run_dir=run_dir, stage=current, contract=contract):
                approved = decision_matches_contract(run_dir=run_dir, contract=contract)
                next_node = stage_contract.routing.on_success if approved else stage_contract.routing.on_failure
                if not approved:
                    review_attempts += 1
                    if review_attempts > MAX_REVIEW_ATTEMPTS:
                        store.set_runtime_state(
                            {
                                "stage": current,
                                "status": "failed",
                                "reason": "review decision remained unapproved after max attempts",
                            }
                        )
                        return 1
            if next_node is None:
                store.set_runtime_state({"stage": current, "status": "completed"})
                return 0
            current = next_node
            continue
        if current in contract.manifest.gates:
            gate = contract.manifest.gates[current]
            if current == "finalize":
                result = run_gate(run_dir=run_dir, gate=current, contract=contract)
                store.set_runtime_state({"stage": current, "status": "completed" if result.ok else "failed"})
                return result.exit_code
            result = retry_gate_with_feedback(
                run_dir=run_dir,
                gate=current,
                server_url=server_url,
                agent_timeout_sec=agent_timeout_sec,
                contract=contract,
                store=store,
                client=client,
            )
            if result.ok:
                current = gate.pass_node
                if current is None:
                    store.set_runtime_state({"stage": result.label, "status": "completed"})
                    return result.exit_code
                continue
            if gate.max_attempts > 1 and gate.fail_node is not None and gate.fail_node.endswith("_feedback"):
                store.set_runtime_state({"stage": result.label, "status": "failed"})
                return result.exit_code
            current = gate.fail_node
            if current is None:
                store.set_runtime_state({"stage": result.label, "status": "completed" if result.ok else "failed"})
                return result.exit_code
            continue
        raise RuntimeError(f"workflow routed to unknown node: {current}")
    store.set_runtime_state({"stage": current, "status": "failed", "reason": "workflow exceeded 256 node transitions"})
    return 1


def retry_gate_with_feedback(
    *,
    run_dir: Path,
    gate: str,
    server_url: str,
    agent_timeout_sec: float,
    contract: WorkflowBundleContract,
    store: SessionStore,
    client: OpencodeHttpClient,
) -> GateResult:
    gate_contract = contract.manifest.gates[gate]
    last = GateResult(gate, 1)
    for attempt in range(1, gate_contract.max_attempts + 1):
        last = run_gate(run_dir=run_dir, gate=gate, contract=contract)
        if last.ok:
            return last
        if attempt < gate_contract.max_attempts and gate_contract.fail_node in contract.manifest.stages:
            run_stage(
                run_dir=run_dir,
                stage=gate_contract.fail_node,
                server_url=server_url,
                agent_timeout_sec=agent_timeout_sec,
                contract=contract,
                store=store,
                client=client,
            )
    return last


def run_stage(
    *,
    run_dir: Path,
    stage: str,
    server_url: str,
    agent_timeout_sec: float,
    contract: WorkflowBundleContract,
    store: SessionStore,
    client: OpencodeHttpClient,
) -> None:
    stage_contract = contract.manifest.stages[stage]
    session = get_or_create_session(contract=contract, store=store, client=client, stage=stage_contract.session)
    attempt = session.prompt_count + 1
    clear_stage_outputs(
        stage,
        run_dir=run_dir,
        repo_root=REPO_ROOT,
        workflow_root=contract.workflow_root,
        manifest=contract.manifest,
    )
    rendered = render_prompt(
        stage=stage,
        workflow_root=contract.workflow_root,
        run_dir=run_dir,
        attempt=attempt,
        repo_root=REPO_ROOT,
        manifest=contract.manifest,
        input_artifact=contract.manifest.run.input_artifact,
    )
    log_runner_event(run_dir, stage, f"submitting prompt {rendered.prompt_path}")
    client.send_prompt_async(session.session_id, agent=session.agent, prompt=rendered.text)
    store.upsert(stage_contract.session, session_id=session.session_id, agent=session.agent, prompt_count=attempt)
    store.append_turn(
        {
            "kind": "stage-prompt",
            "stage": stage,
            "session": stage_contract.session,
            "sessionId": session.session_id,
            "agent": session.agent,
            "attempt": attempt,
            "promptPath": str(rendered.prompt_path),
        }
    )
    wait_for_stage_completion(
        run_dir=run_dir,
        stage=stage,
        session_id=session.session_id,
        client=client,
        agent_timeout_sec=agent_timeout_sec,
        contract=contract,
    )
    ensure_stage_outputs(
        stage,
        run_dir=run_dir,
        repo_root=REPO_ROOT,
        workflow_root=contract.workflow_root,
        manifest=contract.manifest,
    )
    store.set_runtime_state({"stage": stage, "status": "completed", "serverUrl": server_url})


def run_gate(*, run_dir: Path, gate: str, contract: WorkflowBundleContract) -> GateResult:
    gate_contract = contract.manifest.gates[gate]
    command = render_command(gate_contract, run_dir=run_dir)
    cwd = gate_cwd(gate=gate, contract=contract)
    log_dir = run_dir / "artifacts" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_runner_event(run_dir, gate, "running gate: " + " ".join(shlex.quote(part) for part in command))
    completed = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    (log_dir / f"{gate}.stdout.txt").write_text(completed.stdout, encoding="utf-8")
    (log_dir / f"{gate}.stderr.txt").write_text(completed.stderr, encoding="utf-8")
    append_jsonl(
        run_dir / "artifacts" / "events.jsonl",
        {"kind": "gate", "gate": gate, "exitCode": completed.returncode, "ok": completed.returncode == 0},
    )
    return GateResult(gate, completed.returncode)


def render_command(gate: GateContract, *, run_dir: Path) -> list[str]:
    return [part.replace("{{runDirectory}}", str(run_dir)) for part in gate.command]


def gate_cwd(*, gate: str, contract: WorkflowBundleContract) -> Path:
    raw = contract.gate_cwds.get(gate)
    if raw is None:
        return contract.workflow_root
    return (contract.workflow_root / raw).resolve()


def get_or_create_session(
    *,
    contract: WorkflowBundleContract,
    store: SessionStore,
    client: OpencodeHttpClient,
    stage: str,
) -> SessionRecord:
    session_contract = contract.manifest.sessions[stage]
    existing = store.get(stage)
    if existing is not None and client.get_session(existing.session_id) is not None:
        return existing
    created = client.create_session(f"{contract.manifest.run.workflow_name}:{stage}")
    return store.upsert(stage, session_id=created.session_id, agent=session_contract.agent, prompt_count=0)


def ensure_workflow_sessions(
    *,
    run_dir: Path,
    contract: WorkflowBundleContract,
    store: SessionStore,
    client: OpencodeHttpClient,
) -> None:
    for stage in sorted(contract.manifest.sessions):
        get_or_create_session(contract=contract, store=store, client=client, stage=stage)
    refresh_attach_guide(run_dir=run_dir, server_url="<pending>", contract=contract, store=store)


def wait_for_stage_completion(
    *,
    run_dir: Path,
    stage: str,
    session_id: str,
    client: OpencodeHttpClient,
    agent_timeout_sec: float,
    contract: WorkflowBundleContract,
) -> None:
    deadline = time.monotonic() + max(agent_timeout_sec * STAGE_HARD_TIMEOUT_MULTIPLIER, OPEN_ASSISTANT_MAX_WAIT_SEC)
    previous: StageWaitObservation | None = None
    while time.monotonic() < deadline:
        observation = observe_stage_completion(run_dir=run_dir, stage=stage, session_id=session_id, client=client, contract=contract)
        if observation != previous:
            append_jsonl(
                run_dir / "artifacts" / "events.jsonl",
                {
                    "kind": "stage-observe",
                    "stage": stage,
                    "assistantStarted": observation.assistant_started,
                    "assistantCompleted": observation.assistant_completed,
                    "openAssistant": observation.open_assistant,
                    "outputsComplete": observation.outputs_complete,
                    "missingOutputs": list(observation.missing_outputs),
                },
            )
            previous = observation
        if observation.assistant_completed and observation.outputs_complete:
            return
        time.sleep(STAGE_POLL_INTERVAL_SEC)
    raise RuntimeError(f"stage {stage} did not complete before timeout")


def observe_stage_completion(
    *,
    run_dir: Path,
    stage: str,
    session_id: str,
    client: OpencodeHttpClient,
    contract: WorkflowBundleContract,
) -> StageWaitObservation:
    messages_supported = True
    assistant_started = False
    assistant_completed = False
    open_assistant = False
    message_fingerprint = None
    try:
        messages = client.list_messages(session_id)
        assistant_messages = [message for message in messages if message.get("role") == "assistant"]
        assistant_started = bool(assistant_messages)
        assistant_completed = any(_message_looks_complete(message) for message in assistant_messages)
        open_assistant = assistant_started and not assistant_completed
        message_fingerprint = _fingerprint(messages)
    except OpencodeHttpError:
        messages_supported = False
    outputs = []
    missing = []
    for path in _required_paths_for_stage(run_dir=run_dir, stage=stage, contract=contract):
        exists = path.exists()
        outputs.append((str(path), exists, path.stat().st_size if exists else None))
        if not exists:
            missing.append(str(path))
    return StageWaitObservation(
        messages_supported=messages_supported,
        assistant_started=assistant_started,
        assistant_completed=assistant_completed or not messages_supported,
        open_assistant=open_assistant,
        outputs_complete=not missing,
        message_fingerprint=message_fingerprint,
        output_fingerprint=tuple(outputs),
        missing_outputs=tuple(missing),
    )


def _message_looks_complete(message: dict[str, object]) -> bool:
    status = message.get("status")
    if isinstance(status, str) and status.lower() in {"completed", "done", "idle"}:
        return True
    if message.get("time", {}).get("completed") if isinstance(message.get("time"), dict) else False:
        return True
    return bool(message.get("parts") or message.get("content"))


def _required_paths_for_stage(*, run_dir: Path, stage: str, contract: WorkflowBundleContract) -> list[Path]:
    from prompt_assembly import required_output_paths

    return required_output_paths(
        stage,
        run_dir=run_dir,
        repo_root=REPO_ROOT,
        workflow_root=contract.workflow_root,
        manifest=contract.manifest,
    )


def print_observer_summary(
    *,
    run_dir: Path,
    server_url: str,
    contract: WorkflowBundleContract,
    store: SessionStore,
) -> None:
    refresh_attach_guide(run_dir=run_dir, server_url=server_url, contract=contract, store=store)
    guide_path = run_dir / "artifacts" / ATTACH_GUIDE_FILENAME
    print(f"[runner] runDirectory={run_dir}")
    print(f"[runner] opencodeServer={server_url}")
    print(f"[runner] attachGuide={guide_path}")
    print("[runner] attach commands:")
    print(guide_path.read_text(encoding="utf-8"))


def refresh_attach_guide(
    *,
    run_dir: Path,
    server_url: str,
    contract: WorkflowBundleContract,
    store: SessionStore,
) -> None:
    lines = [
        "# OpenCode attach commands",
        f"server={server_url}",
        f"runDirectory={run_dir}",
        "",
        "# Use /exit to leave the TUI client. It should not cancel server-owned execution.",
    ]
    for stage in sorted(contract.manifest.sessions):
        record = store.get(stage)
        if record is None:
            continue
        lines.append("")
        lines.append(f"# {stage}")
        lines.append(attach_command(server_url=server_url, session_id=record.session_id))
    path = run_dir / "artifacts" / ATTACH_GUIDE_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def attach_command(*, server_url: str, session_id: str) -> str:
    return " ".join(
        [
            "opencode",
            "attach",
            shlex.quote(server_url),
            "--dir",
            shlex.quote(str(REPO_ROOT)),
            "--session",
            shlex.quote(session_id),
        ]
    )


def log_runner_event(run_dir: Path, label: str, message: str) -> None:
    append_jsonl(run_dir / "artifacts" / "runner-events.jsonl", {"label": label, "message": message, "time": time.time()})


def append_jsonl(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")


def _fingerprint(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def _stage_controls_decision(*, run_dir: Path, stage: str, contract: WorkflowBundleContract) -> bool:
    if stage != "review":
        artifact_path = run_dir / contract.manifest.decision.artifact
        return artifact_path.exists() and contract.manifest.decision.artifact in contract.manifest.stages[stage].required_outputs
    return True


def decision_matches_contract(*, run_dir: Path, contract: WorkflowBundleContract) -> bool:
    artifact_path = run_dir / contract.manifest.decision.artifact
    if not artifact_path.is_file():
        return False
    payload = json.loads(artifact_path.read_text(encoding="utf-8"))
    cursor: object = payload
    for segment in contract.manifest.decision.json_path:
        if not isinstance(cursor, dict) or segment not in cursor:
            return False
        cursor = cursor[segment]
    return cursor == contract.manifest.decision.equals


if __name__ == "__main__":
    raise SystemExit(main())
