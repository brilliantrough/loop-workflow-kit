# loop-workflow-kit

Reusable assets for building loop-engineering workflows.

This repository is a lightweight kit for future agents that need to construct a staged workflow loop. It focuses on framework-level concerns: graph shape, node contracts, handoff artifacts, prompt injection, gate routing, and retry loops. Domain-specific checkers can be swapped in later.

## Repository Layout

```text
skills/
  loop-workflow-builder/
    SKILL.md
    templates/
      graph-workflow.yaml
      handoff-manifest.json
      typescript/
        gate-checker.ts
        prompt-assembler.ts
templates/
  workflows/
    graph-workflow.yaml
  artifacts/
    handoff-manifest.json
    review-result.json
  typescript/
    gate-checker.ts
    prompt-assembler.ts
workflows/
  operator-dsl-loop/
    workflow.yml
    prompts/
    checks/
docs/
  loop-workflow-design.md
```

## How To Use

1. Load `skills/loop-workflow-builder/SKILL.md` when asked to design or build a loop workflow.
2. Pick a graph shape from `templates/workflows/graph-workflow.yaml`.
3. Define stage artifacts with `templates/artifacts/handoff-manifest.json`.
4. Add domain checkers by adapting `templates/typescript/gate-checker.ts`.
5. Use `workflows/operator-dsl-loop/` as a complete example of a PyTorch-reference-to-DSL-operator workflow skeleton.

This repository is intentionally lightweight. The TypeScript files here are templates to copy into a target runtime repository; this repository itself is not meant to be the workflow runner implementation.

## Core Pattern

The kit assumes a hybrid loop model:

- Humans define stages, gates, artifacts, approval points, and retry budgets.
- Agents execute inside bounded `agent` nodes.
- Deterministic `command` and `gate` nodes own pass/fail decisions.
- Handoff happens through explicit artifacts rather than hidden chat state.

## Included Finished Workflow

`workflows/operator-dsl-loop/` contains the current operator-generation workflow product. It is intentionally framework-first: correctness and performance checks are fake placeholders that prove routing and retry behavior without depending on the target server repository.
