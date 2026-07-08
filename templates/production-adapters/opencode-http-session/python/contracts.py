from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


JSONMap = dict[str, Any]


class WorkflowContractError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class DecisionContract:
    artifact: str
    json_path: tuple[str, ...]
    equals: object
    approval_signal: str | None


@dataclass(frozen=True, slots=True)
class SessionContract:
    engine: str
    agent: str


@dataclass(frozen=True, slots=True)
class InjectionSection:
    label: str
    artifact: str | None
    prompt_template: bool
    required: bool


@dataclass(frozen=True, slots=True)
class StageInjection:
    render_order: tuple[str, ...]
    sections: tuple[InjectionSection, ...]


@dataclass(frozen=True, slots=True)
class StagePersistence:
    selected_artifacts_record: str


@dataclass(frozen=True, slots=True)
class StageRouting:
    on_success: str | None
    on_failure: str | None


@dataclass(frozen=True, slots=True)
class StageContract:
    session: str
    prompt_template: str
    required_outputs: tuple[str, ...]
    clear_on_enter: tuple[str, ...]
    continuation_message: str | None
    injection: StageInjection
    persistence: StagePersistence
    routing: StageRouting


@dataclass(frozen=True, slots=True)
class GateContract:
    command: tuple[str, ...]
    result_artifact: str
    pass_node: str | None
    fail_node: str | None
    max_attempts: int


@dataclass(frozen=True, slots=True)
class ManifestRunContract:
    workflow_name: str
    workflow_version: str
    input_artifact: str
    default_run_directory_root: str
    fresh_run_marker: str
    seed_artifacts: tuple[str, ...]
    run_id_field: str | None
    run_slug_from_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class WorkflowManifest:
    run: ManifestRunContract
    decision: DecisionContract
    sessions: dict[str, SessionContract]
    stages: dict[str, StageContract]
    gates: dict[str, GateContract]


@dataclass(frozen=True, slots=True)
class RunnerRuntimeContract:
    command: str
    transport: str
    adapter: str | None


@dataclass(frozen=True, slots=True)
class PromptAssemblyRuntimeContract:
    manifest: str
    deterministic: bool


@dataclass(frozen=True, slots=True)
class RunDirectoryRuntimeContract:
    root: str
    derive_from_input: str
    resume_policy: str
    fresh_run_marker: str


@dataclass(frozen=True, slots=True)
class ReplayRuntimeContract:
    inspect_command: str
    stage_command: str
    gate_command: str
    sessions_command: str | None


@dataclass(frozen=True, slots=True)
class WorkflowRuntimeContract:
    runner: RunnerRuntimeContract
    prompt_assembly: PromptAssemblyRuntimeContract
    run_directory: RunDirectoryRuntimeContract
    replay: ReplayRuntimeContract
    decision: DecisionContract


@dataclass(frozen=True, slots=True)
class WorkflowBundleContract:
    entry: str
    gate_cwds: dict[str, str | None]
    workflow_path: Path
    workflow_root: Path
    manifest_path: Path
    runtime: WorkflowRuntimeContract
    manifest: WorkflowManifest


def load_bundle_contract(workflow_path: Path) -> WorkflowBundleContract:
    payload = _read_yaml_mapping(workflow_path)
    workflow_root = workflow_path.resolve().parent
    runtime = _parse_runtime(_mapping(payload, "runtime"))
    manifest_path = (workflow_root / runtime.prompt_assembly.manifest).resolve()
    manifest = load_manifest(manifest_path)
    _verify_workflow_matches_manifest(payload, runtime=runtime, manifest=manifest)
    entry = _string(payload, "entry")
    nodes = _mapping(payload, "nodes")
    gate_cwds: dict[str, str | None] = {}
    for gate in manifest.gates:
        raw = _as_mapping(nodes.get(gate), f"nodes.{gate}")
        gate_cwds[gate] = _optional_string(raw, "cwd")
    return WorkflowBundleContract(
        entry=entry,
        gate_cwds=gate_cwds,
        workflow_path=workflow_path.resolve(),
        workflow_root=workflow_root,
        manifest_path=manifest_path,
        runtime=runtime,
        manifest=manifest,
    )


def load_manifest(path: Path) -> WorkflowManifest:
    payload = _read_json_mapping(path)
    run = _mapping(payload, "run")
    decision = _parse_decision(_mapping(payload, "decision"))
    sessions_payload = _mapping(payload, "sessions")
    stages_payload = _mapping(payload, "stages")
    gates_payload = _mapping(payload, "gates", allow_missing=True)
    sessions = {
        name: SessionContract(
            engine=_string(_as_mapping(raw, f"sessions.{name}"), "engine"),
            agent=_string(_as_mapping(raw, f"sessions.{name}"), "agent"),
        )
        for name, raw in sessions_payload.items()
    }
    stages = {
        name: _parse_stage_contract(name, _as_mapping(raw, f"stages.{name}"))
        for name, raw in stages_payload.items()
    }
    gates = {
        name: _parse_gate_contract(name, _as_mapping(raw, f"gates.{name}"))
        for name, raw in gates_payload.items()
    }
    run_id_field = _optional_string(run, "runIdField")
    run_slug_from_fields = tuple(_string_list(run, "runSlugFromFields", allow_missing=True))
    return WorkflowManifest(
        run=ManifestRunContract(
            workflow_name=_string(run, "workflowName"),
            workflow_version=_string(run, "workflowVersion"),
            input_artifact=_string(run, "inputArtifact"),
            default_run_directory_root=_string(run, "defaultRunDirectoryRoot"),
            fresh_run_marker=_string(run, "freshRunMarker"),
            seed_artifacts=tuple(_string_list(run, "seedArtifacts")),
            run_id_field=run_id_field,
            run_slug_from_fields=run_slug_from_fields,
        ),
        decision=decision,
        sessions=sessions,
        stages=stages,
        gates=gates,
    )


def _parse_runtime(payload: Mapping[str, object]) -> WorkflowRuntimeContract:
    runner = _mapping(payload, "runner")
    prompt_assembly = _mapping(payload, "promptAssembly")
    run_directory = _mapping(payload, "runDirectory")
    replay = _mapping(payload, "replay")
    decision = _parse_decision(_mapping(payload, "decision"))
    return WorkflowRuntimeContract(
        runner=RunnerRuntimeContract(
            command=_string(runner, "command"),
            transport=_string(runner, "transport"),
            adapter=_optional_string(runner, "adapter"),
        ),
        prompt_assembly=PromptAssemblyRuntimeContract(
            manifest=_string(prompt_assembly, "manifest"),
            deterministic=_bool(prompt_assembly, "deterministic"),
        ),
        run_directory=RunDirectoryRuntimeContract(
            root=_string(run_directory, "root"),
            derive_from_input=_string(run_directory, "deriveFromInput"),
            resume_policy=_string(run_directory, "resumePolicy"),
            fresh_run_marker=_string(run_directory, "freshRunMarker"),
        ),
        replay=ReplayRuntimeContract(
            inspect_command=_string(replay, "inspectCommand"),
            stage_command=_string(replay, "stageCommand"),
            gate_command=_string(replay, "gateCommand"),
            sessions_command=_optional_string(replay, "sessionsCommand"),
        ),
        decision=decision,
    )


def _parse_decision(payload: Mapping[str, object]) -> DecisionContract:
    return DecisionContract(
        artifact=_string(payload, "artifact"),
        json_path=tuple(_string_list(payload, "jsonPath")),
        equals=payload.get("equals"),
        approval_signal=_optional_string(payload, "approvalSignal"),
    )


def _parse_stage_contract(stage: str, payload: Mapping[str, object]) -> StageContract:
    injection = _mapping(payload, "injection")
    persistence = _mapping(payload, "persistence")
    routing = _mapping(payload, "routing")
    sections_payload = _list(injection, "sections")
    sections = tuple(
        InjectionSection(
            label=_string(_as_mapping(section, f"{stage}.section"), "label"),
            artifact=_optional_string(_as_mapping(section, f"{stage}.section"), "artifact"),
            prompt_template=_bool_or_default(_as_mapping(section, f"{stage}.section"), "promptTemplate", False),
            required=_bool(_as_mapping(section, f"{stage}.section"), "required"),
        )
        for section in sections_payload
    )
    return StageContract(
        session=_string(payload, "session"),
        prompt_template=_string(payload, "promptTemplate"),
        required_outputs=tuple(_string_list(payload, "requiredOutputs")),
        clear_on_enter=tuple(_string_list(payload, "clearOnEnter")),
        continuation_message=_optional_string(payload, "continuationMessage"),
        injection=StageInjection(render_order=tuple(_string_list(injection, "renderOrder")), sections=sections),
        persistence=StagePersistence(selected_artifacts_record=_string(persistence, "selectedArtifactsRecord")),
        routing=StageRouting(
            on_success=_optional_string(routing, "onSuccess"),
            on_failure=_optional_string(routing, "onFailure"),
        ),
    )


def _parse_gate_contract(gate: str, payload: Mapping[str, object]) -> GateContract:
    return GateContract(
        command=tuple(_string_list(payload, "command")),
        result_artifact=_string(payload, "resultArtifact"),
        pass_node=_optional_string(payload, "pass"),
        fail_node=_optional_string(payload, "fail"),
        max_attempts=_int_or_default(payload, "maxAttempts", 1),
    )


def _verify_workflow_matches_manifest(
    workflow: Mapping[str, object],
    *,
    runtime: WorkflowRuntimeContract,
    manifest: WorkflowManifest,
) -> None:
    if runtime.runner.transport != "opencode-http-session":
        raise WorkflowContractError("production template expects runtime.runner.transport=opencode-http-session")
    if runtime.prompt_assembly.manifest != "handoff-manifest.json":
        raise WorkflowContractError("production template expects promptAssembly.manifest=handoff-manifest.json")
    nodes = _mapping(workflow, "nodes")
    for stage in manifest.stages:
        if stage not in nodes:
            raise WorkflowContractError(f"manifest stage missing workflow node: {stage}")
    for gate in manifest.gates:
        if gate not in nodes:
            raise WorkflowContractError(f"manifest gate missing workflow node: {gate}")


def _read_yaml_mapping(path: Path) -> Mapping[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    return _as_mapping(payload, str(path))


def _read_json_mapping(path: Path) -> Mapping[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return _as_mapping(payload, str(path))


def _as_mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise WorkflowContractError(f"expected JSON/YAML object at {label}")
    return value


def _mapping(payload: Mapping[str, object], key: str, *, allow_missing: bool = False) -> Mapping[str, object]:
    value = payload.get(key)
    if value is None and allow_missing:
        return {}
    return _as_mapping(value, key)


def _list(payload: Mapping[str, object], key: str) -> list[object]:
    value = payload.get(key)
    if not isinstance(value, list):
        raise WorkflowContractError(f"expected list at {key}")
    return value


def _string(payload: Mapping[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise WorkflowContractError(f"expected non-empty string at {key}")
    return value


def _optional_string(payload: Mapping[str, object], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise WorkflowContractError(f"expected non-empty string or null at {key}")
    return value


def _string_list(payload: Mapping[str, object], key: str, *, allow_missing: bool = False) -> list[str]:
    value = payload.get(key)
    if value is None and allow_missing:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise WorkflowContractError(f"expected string list at {key}")
    return list(value)


def _bool(payload: Mapping[str, object], key: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise WorkflowContractError(f"expected boolean at {key}")
    return value


def _bool_or_default(payload: Mapping[str, object], key: str, default: bool) -> bool:
    value = payload.get(key, default)
    if not isinstance(value, bool):
        raise WorkflowContractError(f"expected boolean at {key}")
    return value


def _int_or_default(payload: Mapping[str, object], key: str, default: int) -> int:
    value = payload.get(key, default)
    if not isinstance(value, int) or value < 1:
        raise WorkflowContractError(f"expected positive integer at {key}")
    return value
