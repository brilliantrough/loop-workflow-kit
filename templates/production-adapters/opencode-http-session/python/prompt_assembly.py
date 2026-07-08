from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from contracts import InjectionSection, StageContract, WorkflowManifest


WORKFLOW_LOCAL_PREFIXES = ("rules/", "prompts/", "reference/")


@dataclass(frozen=True, slots=True)
class PromptRender:
    stage: str
    text: str
    prompt_path: Path


def render_prompt(
    *,
    stage: str,
    workflow_root: Path,
    run_dir: Path,
    attempt: int,
    repo_root: Path,
    manifest: WorkflowManifest,
    input_artifact: str,
) -> PromptRender:
    stage_contract = manifest.stages[stage]
    prompt_template_path = workflow_root / stage_contract.prompt_template
    sections = [
        render_runner_context(
            stage,
            stage_contract=stage_contract,
            run_dir=run_dir,
            repo_root=repo_root,
        )
    ]
    selected_artifacts: list[dict[str, str]] = []
    for label in stage_contract.injection.render_order:
        section = _find_section(stage_contract, label=label, stage=stage)
        rendered = read_section_body(
            section=section,
            prompt_template_path=prompt_template_path,
            workflow_root=workflow_root,
            run_dir=run_dir,
            repo_root=repo_root,
        )
        if rendered is None:
            continue
        body, resolved_path = rendered
        sections.append(f"# {section.label}\n\n{body}")
        if resolved_path is not None:
            selected_artifacts.append({"label": section.label, "path": display_path(resolved_path, repo_root=repo_root)})
    if stage_contract.continuation_message is not None:
        sections.append("# Continuation Message\n\n" + stage_contract.continuation_message)
    prompt_path = run_dir / "artifacts" / "prompts" / f"{stage}-{attempt}.md"
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_text = "\n\n".join(section for section in sections if section.strip()) + "\n"
    prompt_path.write_text(prompt_text, encoding="utf-8")
    selected_path = run_dir / stage_contract.persistence.selected_artifacts_record
    selected_path.parent.mkdir(parents=True, exist_ok=True)
    selected_path.write_text(json.dumps(selected_artifacts, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return PromptRender(stage=stage, text=prompt_text, prompt_path=prompt_path)


def ensure_stage_outputs(
    stage: str,
    *,
    run_dir: Path,
    repo_root: Path,
    workflow_root: Path,
    manifest: WorkflowManifest,
) -> None:
    missing = [
        path
        for path in required_output_paths(stage, run_dir=run_dir, repo_root=repo_root, workflow_root=workflow_root, manifest=manifest)
        if not path.exists()
    ]
    if missing:
        raise RuntimeError("stage " + stage + " is missing required outputs: " + ", ".join(str(path) for path in missing))


def required_output_paths(
    stage: str,
    *,
    run_dir: Path,
    repo_root: Path,
    workflow_root: Path,
    manifest: WorkflowManifest,
) -> list[Path]:
    stage_contract = manifest.stages[stage]
    return [
        resolve_contract_path(spec, workflow_root=workflow_root, run_dir=run_dir, repo_root=repo_root)
        for spec in stage_contract.required_outputs
    ]


def clear_stage_outputs(
    stage: str,
    *,
    run_dir: Path,
    repo_root: Path,
    workflow_root: Path,
    manifest: WorkflowManifest,
) -> None:
    stage_contract = manifest.stages[stage]
    for spec in stage_contract.clear_on_enter:
        path = resolve_contract_path(spec, workflow_root=workflow_root, run_dir=run_dir, repo_root=repo_root)
        if path.is_dir():
            continue
        if path.exists():
            path.unlink()


def resolve_contract_path(spec: str, *, workflow_root: Path, run_dir: Path, repo_root: Path) -> Path:
    if spec.startswith(WORKFLOW_LOCAL_PREFIXES):
        return workflow_root / spec
    candidate = Path(spec)
    if candidate.is_absolute():
        return candidate
    return run_dir / spec


def render_runner_context(stage: str, *, stage_contract: StageContract, run_dir: Path, repo_root: Path) -> str:
    outputs = "\n".join(f"- {relative}" for relative in stage_contract.required_outputs)
    return (
        "## Runner Context\n\n"
        f"- Stage key: `{stage}`\n"
        f"- Repository root: `{repo_root}`\n"
        f"- Run directory: `{run_dir}`\n"
        "- Required outputs:\n"
        f"{outputs}"
    )


def read_section_body(
    *,
    section: InjectionSection,
    prompt_template_path: Path,
    workflow_root: Path,
    run_dir: Path,
    repo_root: Path,
) -> tuple[str, Path | None] | None:
    if section.prompt_template:
        return prompt_template_path.read_text(encoding="utf-8"), None
    if section.artifact is None:
        raise RuntimeError(f"Section '{section.label}' must define artifact or promptTemplate")
    artifact_path = resolve_contract_path(section.artifact, workflow_root=workflow_root, run_dir=run_dir, repo_root=repo_root)
    if artifact_path.exists():
        return format_artifact_body(artifact_path), artifact_path
    if section.required:
        raise RuntimeError(f"Missing required artifact: {section.artifact}")
    return None


def format_artifact_body(path: Path) -> str:
    if path.suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        body = json.dumps(payload, indent=2, sort_keys=True)
        return f"```json\n{body}\n```"
    return f"```text\n{path.read_text(encoding='utf-8')}\n```"


def display_path(path: Path, *, repo_root: Path) -> str:
    try:
        return str(path.relative_to(repo_root))
    except ValueError:
        return str(path)


def _find_section(stage_contract: StageContract, *, label: str, stage: str) -> InjectionSection:
    for section in stage_contract.injection.sections:
        if section.label == label:
            return section
    raise RuntimeError(f"Missing injection section '{label}' for stage '{stage}'")
