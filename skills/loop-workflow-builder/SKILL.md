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

## Graph Design Rules

- Put correctness and performance decisions in `gate` or `command` nodes, not in agent self-reporting.
- Use `max_attempts` on repair and optimization nodes.
- Make review feedback route back to `plan` when the plan itself needs revision.
- Keep agent prompts stage-specific; move domain rules into separate rule artifacts.
- Persist all pass/fail evidence into artifacts before routing.

## Templates

Use the templates in this skill directory:

- `templates/graph-workflow.yaml`
- `templates/handoff-manifest.json`
- `templates/typescript/gate-checker.ts`
- `templates/typescript/prompt-assembler.ts`

## Common Mistakes

| Mistake | Fix |
|---|---|
| Agent decides whether correctness passed | Put correctness in a `gate` command |
| Next prompt is written as free prose by previous agent | Generate artifacts, then assemble prompt deterministically |
| Retry loop has no budget | Add `max_attempts` to repair/optimize node |
| Review failure patches code directly | Route review failure back to `plan` when strategy changed |
| State lives only in chat | Persist `state.json`, stage outputs, and gate result JSON |
