from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


StateMap = dict[str, object]


@dataclass(frozen=True, slots=True)
class SessionRecord:
    stage: str
    session_id: str
    agent: str
    prompt_count: int


class SessionStore:
    def __init__(self, run_dir: Path) -> None:
        self._path = run_dir / "artifacts" / "opencode-sessions.json"
        self._turns_path = run_dir / "artifacts" / "opencode-turns.jsonl"

    def get(self, stage: str) -> SessionRecord | None:
        payload = self._load()
        sessions = payload.get("sessions")
        if not isinstance(sessions, dict):
            return None
        raw = sessions.get(stage)
        if not isinstance(raw, dict):
            return None
        session_id = raw.get("id")
        agent = raw.get("agent")
        prompt_count = raw.get("promptCount", 0)
        if not isinstance(session_id, str) or not isinstance(agent, str) or not isinstance(prompt_count, int):
            return None
        return SessionRecord(stage=stage, session_id=session_id, agent=agent, prompt_count=prompt_count)

    def upsert(self, stage: str, *, session_id: str, agent: str, prompt_count: int) -> SessionRecord:
        payload = self._load()
        sessions = payload.setdefault("sessions", {})
        if not isinstance(sessions, dict):
            raise RuntimeError("session store sessions payload is not a JSON object")
        sessions[stage] = {"id": session_id, "agent": agent, "promptCount": prompt_count}
        self._write(payload)
        return SessionRecord(stage=stage, session_id=session_id, agent=agent, prompt_count=prompt_count)

    def append_turn(self, record: dict[str, object]) -> None:
        self._turns_path.parent.mkdir(parents=True, exist_ok=True)
        with self._turns_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")

    def set_runtime_state(self, state: dict[str, object]) -> None:
        payload = self._load()
        payload["runtimeState"] = state
        self._write(payload)

    def _load(self) -> StateMap:
        if not self._path.is_file():
            return {}
        payload = json.loads(self._path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError("session store payload must be a JSON object")
        return dict(payload)

    def _write(self, payload: StateMap) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
