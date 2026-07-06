---
name: loop-workflow-builder
description: Use when designing or generating a staged agent workflow with graph nodes, handoff artifacts, deterministic gates, retry loops, or review feedback cycles.
---

# Loop Workflow Builder

## Overview

Build loop workflows as explicit graphs. The workflow controls stage order, gates, retries, and artifact movement; agents only execute inside bounded `agent` nodes.

## When To Use

Use this skill when the request involves:

- Loop engineering or agent workflow design
- `plan -> implement -> test -> optimize -> review` style pipelines
- Conditional routing such as `pass`, `fail`, or `next`
- Human or deterministic gate nodes
- Dynamic handoff prompts between agents
- Reusable workflow YAML, JSON manifests, or TypeScript checker templates

Do not use this for a one-shot coding task with no stage boundaries.

When the workflow prototype needs to move into a real runtime repository, pair this skill with `workflow-production-adapter`.

## Prompt And Handoff Separation

Every `agent` node should have a fixed stage prompt. That prompt should include:

- a short overview of the full workflow graph
- the current stage name and responsibility
- required inputs and required outputs
- hard rules for what the stage must not do

Agents must not write prompts for later stages. They should write handoff notes or structured artifacts. The runner then injects those artifacts into the next fixed prompt according to the handoff manifest.

When a workflow needs iterative correction, prefer persistent agent sessions plus feedback nodes over extra repair agents. A feedback node should inject the failed gate artifact and a fixed continuation message into the same agent session, then route back to the gate.

## Core Design

Every workflow should define four surfaces:

| Surface | Purpose | Artifact |
|---|---|---|
| Graph | Controls routing and loops | `workflow.yml` |
| Handoff | Moves context between stages | `handoff-manifest.json` |
| Gates | Decide pass/fail outside the agent | checker scripts and result JSON |
| Review | Converts rule failures into feedback | `review-result.json` |

## Node Types

Use only these node kinds unless the runner supports more:

```yaml
nodes:
  plan:
    kind: agent
    engine: opencode
    prompt: prompts/plan.md
    next: codegen

  correctness:
    kind: gate
    command: ["bun", "run", "checks/correctness.ts", "--run-dir", "{{runDirectory}}"]
    pass: perf
    fail: repair_correctness

  perf:
    kind: command
    command: ["bun", "run", "checks/perf.ts", "--run-dir", "{{runDirectory}}"]
    pass: review
    fail: optimize
```

## Handoff Prompt Contract

Do not ask an agent to freely invent the next prompt. Instead:

1. Agent writes structured output or a handoff note.
2. Framework records it as an artifact.
3. Next node prompt is assembled from a template plus selected artifacts.

Required handoff manifest sections:

- `run`: stable run identity and root input artifact
- `sourceStage`: which stage produced this handoff
- `targetStage`: target role, prompt template, required outputs, stop condition
- `injection`: ordered sections and artifact selection rules
- `persistence`: what the runner must write down for replay and audit
- `routing`: default on-success / on-failure destinations

Preferred prompt assembly shape:

```md
# Role
{{stage.role}}

# Run Input
{{artifact("input.json")}}

# Stage Instructions
{{prompt_template}}

# Previous Artifacts
{{artifact("artifacts/plan.json")}}
{{artifact("artifacts/correctness.json")}}

# Required Outputs
{{stage.outputs}}

# Stop Condition
Do not report completion unless every required output exists.
```

The runner, not the previous agent, should choose which artifacts to inject and in what order. The manifest is the contract the runner consumes.

## Graph Design Rules

- Put correctness and performance decisions in `gate` or `command` nodes, not in agent self-reporting.
- Treat judgment nodes as configurable by workflow philosophy: use bash/command gates for hard checks by default, and use agent judgment only when the user explicitly wants qualitative review or rubric-based assessment.
- In prototype workflows, bash/command gates may be fake placeholders when the real validator belongs in a production repository. The fake gate must still preserve the intended CLI shape, artifact names, pass/fail routing, and machine-readable result schema.
- Label fake gates clearly. They prove workflow behavior; they do not prove production correctness or performance.
- Do not accidentally turn a failed gate into a new worker agent. If the same worker should continue, inject the gate output back into the existing persistent session through a feedback node.
- Use `max_attempts` on repair and optimization nodes.
- Make review feedback route back to `plan` when the plan itself needs revision.
- Keep agent prompts stage-specific; move domain rules into separate rule artifacts.
- Persist all pass/fail evidence into artifacts before routing.
- Make every gate result machine-readable with fields for `gateId`, `ok`, `route`, and `checkedArtifacts`.
- Make every review result machine-readable with fields for `decision`, `feedback`, and `routing`.

## Templates

Use the templates in this skill directory:

- `templates/graph-workflow.yaml`
- `templates/handoff-manifest.json`
- `templates/typescript/gate-checker.ts`
- `templates/typescript/prompt-assembler.ts`

The packaged `workflows/operator-dsl-loop/` example is meant to be prototype-complete at the framework layer. Production repositories should preserve its graph and artifact contracts while replacing fake commands, rule files, and runtime adapters.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Agent decides whether correctness passed | Put correctness in a `gate` command |
| Prototype gate is omitted because real checker is not ready | Add a fake bash/command placeholder with the final CLI and artifact contract |
| Fake gate is treated as production validation | Mark it as fake and replace it during production adaptation |
| A command gate failure becomes a separate repair agent | Continue the same persistent agent session with injected gate output |
| Every judgment node is modeled as bash | Use an agent judgment node when the user wants qualitative review |
| Next prompt is written as free prose by previous agent | Generate artifacts, then assemble prompt deterministically from a handoff manifest |
| Retry loop has no budget | Add `max_attempts` to repair/optimize node |
| Review failure patches code directly | Route review failure back to `plan` when strategy changed |
| State lives only in chat | Persist `state.json`, stage outputs, and gate result JSON |
