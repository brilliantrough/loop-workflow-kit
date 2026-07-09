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
  production-adapters/
    opencode-http-session/
      workflow-runtime.snippet.yaml
      workflow-runtime.python.snippet.yaml
      workflow-runtime.typescript.snippet.yaml
      python/
        runner.py
        runner_replay.py
        opencode_http.py
        opencode_server.py
        session_store.py
      typescript/
        runner.ts
        runner-replay.ts
        opencode-http.ts
        opencode-server.ts
        session-store.ts
  typescript/
    gate-checker.ts
    prompt-assembler.ts
workflow-monitor/
  package.json
  server/
  src/
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
2. Scaffold a runnable starter with `bun run scaffold:workflow -- --name <workflow-name>`.
3. Refine the graph shape from `templates/workflows/graph-workflow.yaml`.
4. Refine stage artifacts with `templates/artifacts/handoff-manifest.json`.
5. Add or replace domain checkers by adapting `templates/typescript/gate-checker.ts`.
6. Use `workflows/operator-dsl-loop/` as a prototype-complete example of a migrated workflow skeleton.
7. Load `skills/workflow-production-adapter/SKILL.md` when moving the prototype into a real runtime repository.

## Scaffold

Create a new runnable workflow prototype under `workflows/`:

```bash
bun run scaffold:workflow -- --name my-workflow
```

This generates:

- `workflow.yml` with generic `prototype:run` / `prototype:replay` surfaces
- `handoff-manifest.json` with session, stage, and gate contracts
- seed prompts, fake checks, rules, reference input, and sample artifacts
- `input.schema.json` and a workflow-local README

For production adaptation, the kit also ships a concrete OpenCode transport starter under:

```text
templates/production-adapters/opencode-http-session/
```

That directory includes generic Python and TypeScript/Bun production runners, replay commands, HTTP/session helpers, server bootstrap, session persistence, attach-command generation, and runtime snippets so migration does not need to rediscover `opencode serve` interaction from scratch.

The kit now also ships a reusable TypeScript workflow monitor frontend under:

```text
workflow-monitor/
```

Its contract boundary is file-based:

- runners publish `artifacts/workflow-monitor.snapshot.json`
- runners append `artifacts/workflow-monitor.events.jsonl`
- the monitor server recursively scans a shared runs root and reads only per-run snapshot files
- the React frontend reads only `/api/runs`, `/api/runs/stream`, `/api/snapshot?run=<id>`, `/api/stream?run=<id>`, and `/api/file/*`

The live transport is SSE. The Bun server polls the file contract and pushes updates downstream; file preview stays read-only and limited to repo-local roots plus the shared runs root after real-path validation. The run library supports nested workflow roots, search/filter/sort, active-versus-stale detection, node durations, execution-path highlighting, follow mode, and enhanced artifact inspection.

## Prototype Runner

This kit includes a local session-capable prototype runner so the packaged workflow has a concrete startup command:

```bash
bun run prototype:run -- --workflow workflows/operator-dsl-loop/workflow.yml
```

The prototype runner reads `workflows/operator-dsl-loop/workflow.yml`, loads `handoff-manifest.json`, derives a canonical run directory, creates or resumes fake persistent sessions, assembles prompts from the fixed stage templates plus selected artifacts, and executes the fake command/gate scripts. It is not a production runner because the session adapter and validators are still fake.

It also exposes replay/debug entrypoints:

```bash
bun run prototype:replay -- --workflow workflows/operator-dsl-loop/workflow.yml --mode inspect --run-dir .runs/operator-dsl-loop/layer-norm-operator-dsl
bun run prototype:replay -- --workflow workflows/operator-dsl-loop/workflow.yml --mode sessions --run-dir .runs/operator-dsl-loop/layer-norm-operator-dsl
bun run prototype:replay -- --workflow workflows/operator-dsl-loop/workflow.yml --mode stage --run-dir .runs/operator-dsl-loop/layer-norm-operator-dsl --stage codegen
bun run prototype:replay -- --workflow workflows/operator-dsl-loop/workflow.yml --mode gate --run-dir .runs/operator-dsl-loop/layer-norm-operator-dsl --gate correctness
```

Each run also writes `artifacts/prototype-debug-commands.txt`, which materializes the inspect, sessions, stage-replay, and gate-replay commands for that concrete run directory. This mirrors the production need for a stable observability surface even before a real engine transport exists.

This repository is intentionally lightweight, but it now owns the prototype runtime skeleton and a copyable OpenCode production adapter skeleton. Target runtime repositories should replace environment-specific gates and domain paths, not reinvent session lifecycle, prompt assembly, replay, session observability, or artifact persistence.

## Monitor UI

Build and start the monitor against the repo-local `.runs` root:

```bash
cd workflow-monitor
bun install
bun run build
bun run start
```

Optional: point it at another runs root and highlight one run:

```bash
bun run start -- --runs-root /abs/path/to/.runs --default-run /abs/path/to/.runs/operator-dsl-loop/<run-slug>
```

The same UI can watch the prototype runner in this repo or a production repository, as long as that runner writes the same snapshot contract.

## Python vs TypeScript/Bun

The preferred split is contract sharing, not runtime-code sharing:

- TypeScript/Bun owns the prototype layer in this kit: workflow scaffolding, fake sessions, fake gates, prompt assembly proof, fast replay, and `bun test` contract checks.
- Python production adapter owns real `opencode serve` startup, OpenCode HTTP calls, session id persistence, attach commands, replay, and command/gate execution for Python-first target repositories.
- TypeScript/Bun production adapter owns the same production surface for Bun-first target repositories, especially when gates/checkers and orchestration code are already TypeScript.
- Both layers consume the same `workflow.yml`, `handoff-manifest.json`, input artifact, gate JSON, review JSON, and required-output contracts.
- A workflow should migrate by copying the contract plus exactly one production adapter template, then specializing the production gates and environment hooks.

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
- session-capable prototype startup and replay commands
- explicit session-observability surfaces through `sessions` replay plus a generated debug guide
- stage prompt roles and output expectations
- manifest-driven prompt assembly and selected-artifact persistence
- handoff and review artifact shapes
- stage-to-stage handoff text as runtime state, not prompt generation
- fake but machine-readable gate outputs
- explicit rule artifacts for planning and review

Production-complete still belongs in the target repository. That repository must replace the fake commands and fake session adapter, align paths and sandboxes, and add observability plus environment-specific integrations.
