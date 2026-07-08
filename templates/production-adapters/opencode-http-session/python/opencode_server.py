from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from opencode_http import OpencodeHttpClient, OpencodeHttpConfig, OpencodeHttpError


SERVER_READY_DEADLINE_SEC = 20.0
SERVER_POLL_INTERVAL_SEC = 0.25


class OpencodeServerError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class OpencodeServerState:
    base_url: str
    host: str
    port: int
    owned_by_runner: bool
    process_pid: int | None
    version: str | None
    log_path: Path


def ensure_server(
    *,
    base_url: str,
    host: str,
    port: int,
    no_start: bool,
    timeout_sec: float,
    run_dir: Path,
    workdir: Path,
    username: str | None,
    password: str | None,
) -> OpencodeServerState:
    client = OpencodeHttpClient(
        OpencodeHttpConfig(base_url=base_url, timeout_sec=timeout_sec, username=username, password=password)
    )
    health = _try_health(client)
    log_path = run_dir / "artifacts" / "opencode-server.log"
    if health is not None:
        return OpencodeServerState(base_url, host, port, False, None, _health_version(health), log_path)
    if no_start:
        raise OpencodeServerError(f"OpenCode server is not reachable at {base_url}")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_handle = log_path.open("a", encoding="utf-8")
    process = subprocess.Popen(
        ["opencode", "serve", "--hostname", host, "--port", str(port), "--print-logs"],
        cwd=workdir,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
    )
    deadline = time.monotonic() + SERVER_READY_DEADLINE_SEC
    while time.monotonic() < deadline:
        health = _try_health(client)
        if health is not None:
            return OpencodeServerState(base_url, host, port, True, process.pid, _health_version(health), log_path)
        if process.poll() is not None:
            break
        time.sleep(SERVER_POLL_INTERVAL_SEC)
    process.terminate()
    process.wait(timeout=5)
    raise OpencodeServerError(f"failed to start OpenCode server at {base_url}; see {log_path}")


def stop_server(state: OpencodeServerState) -> None:
    if not state.owned_by_runner or state.process_pid is None:
        return
    subprocess.run(["kill", str(state.process_pid)], check=False)


def write_server_state(path: Path, state: OpencodeServerState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "baseUrl": state.base_url,
                "host": state.host,
                "port": state.port,
                "ownedByRunner": state.owned_by_runner,
                "processPid": state.process_pid,
                "version": state.version,
                "logPath": str(state.log_path),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _try_health(client: OpencodeHttpClient) -> dict[str, object] | None:
    try:
        payload = client.health()
    except OpencodeHttpError:
        return None
    return dict(payload)


def _health_version(health: dict[str, object]) -> str | None:
    value = health.get("version")
    return value if isinstance(value, str) else None
