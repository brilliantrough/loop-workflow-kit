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
  workflow-production-adapter/
    SKILL.md
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
    artifacts/
    generated/
    reference/
    rules/
docs/
  loop-workflow-design.md
```

## How To Use

1. Load `skills/loop-workflow-builder/SKILL.md` when asked to design or build a loop workflow.
2. Pick a graph shape from `templates/workflows/graph-workflow.yaml`.
3. Define stage artifacts with `templates/artifacts/handoff-manifest.json`.
4. Add domain checkers by adapting `templates/typescript/gate-checker.ts`.
5. Use `workflows/operator-dsl-loop/` as a prototype-complete example of a PyTorch-reference-to-DSL-operator workflow skeleton.
6. Load `skills/workflow-production-adapter/SKILL.md` when moving the prototype into a real runtime repository.

## Placeholder Runner

This kit includes a local placeholder runner so the packaged workflow has a concrete startup command:

```bash
bun run prototype:operator
```

The placeholder runner reads `workflows/operator-dsl-loop/workflow.yml`, seeds `.runs/operator-dsl-loop`, logs where production agent sessions must start or resume, and executes the fake command/gate scripts. It is not a production runner.

This repository is intentionally lightweight. The TypeScript files here are templates to copy into a target runtime repository; this repository itself is not meant to be the workflow runner implementation.

## Core Pattern

The kit assumes a hybrid loop model:

- Humans define stages, gates, artifacts, approval points, and retry budgets.
- Agents execute inside bounded `agent` nodes with fixed stage prompts.
- Deterministic `command` and `gate` nodes usually own hard pass/fail decisions.
- Agent judgment nodes are valid when the workflow intentionally requires qualitative review, but should not be introduced accidentally.
- Prototype `command` and `gate` nodes may use fake bash-compatible placeholders to prove routing and artifact contracts before production validators exist.
- Handoff happens through explicit artifacts and handoff notes rather than hidden chat state.

## Included Finished Workflow

`workflows/operator-dsl-loop/` contains the current operator-generation workflow product. It is intentionally framework-first: correctness and performance checks stay fake, but the workflow now includes the prototype artifacts, rule files, review contract, and finalize path that a production migration needs to preserve.

Prototype-complete in this repo means every framework contract is named and exemplified:

- graph routing and retry budgets
- placeholder runner startup command
- stage prompt roles and output expectations
- handoff and review artifact shapes
- stage-to-stage handoff text as runtime state, not prompt generation
- fake but machine-readable gate outputs
- explicit rule artifacts for planning and review

Production-complete still belongs in the target repository. That repository must replace the fake commands, wire a real runner, align paths and sandboxes, and add observability, debug entrypoints, and environment-specific integrations.
