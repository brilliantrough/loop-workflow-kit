---
name: workflow-production-adapter
description: Use when moving a workflow prototype from this kit into a real runtime repository, especially when fake gates, sample artifacts, runner wiring, logging, or debug entrypoints must be replaced with production adapters.
---

# Workflow Production Adapter

## Overview

This skill migrates a workflow prototype into a production repository without redesigning the workflow shape. The kit owns contracts; the production repository owns adapters.

## When To Use

Use this skill when:

- a workflow from this repository is being copied into a real server or runtime repository
- fake correctness, performance, or finalize commands need real implementations
- sample artifacts must be replaced with runtime-generated inputs and persisted outputs
- a fake session adapter or prototype runner must be replaced with real engine/session adapters
- a runner must replay stages, gates, and reviews during debugging

Do not use this to redesign the workflow graph itself. Use `loop-workflow-builder` first when the graph is still unsettled.

## Migration Rule

Keep these stable unless the runner contract itself is changing:

- node ids and routing semantics
- handoff manifest structure
- gate result shape
- review result shape
- stage output expectations
- prototype runner startup, replay, and persistent-session behavior used to prove the prototype flow

Replace these inside the production repository:

- fake `checks/*.ts` commands
- the fake session adapter and prototype runner started by `bun run prototype:run -- --workflow ...`
- sample `artifacts/*.json` input and evidence files
- sample `rules/*.md` policy files
- placeholder paths, `cwd`, and sandbox choices

If the target repository will use a real OpenCode server/session transport, start from:

- `templates/production-adapters/opencode-http-session/workflow-runtime.snippet.yaml`
- `templates/production-adapters/opencode-http-session/workflow-runtime.python.snippet.yaml`
- `templates/production-adapters/opencode-http-session/workflow-runtime.typescript.snippet.yaml`
- `templates/production-adapters/opencode-http-session/python/`
- `templates/production-adapters/opencode-http-session/typescript/`

Those files exist specifically to avoid rediscovering OpenCode server bootstrap, session persistence, attach commands, prompt rendering, replay entrypoints, and HTTP interaction during migration.

Pick exactly one production adapter language per migrated workflow unless the target repository explicitly needs both. Choose Python for Python-first runtime/checker ecosystems; choose TypeScript/Bun for Bun-first orchestration and checker ecosystems.

## Production Checklist

### 1. Map the runtime seam

For each workflow node, decide which adapter the production repository owns:

- `agent` node -> which engine and sandbox policy actually run it
- `gate` or `command` node -> which script or binary performs the real check
- `finalize` node -> which publish, register, or export action ends the loop

Most hard judgment nodes should become bash-compatible commands or binaries in production. Use an agent as a judgment node only when the workflow intentionally asks for qualitative review, policy interpretation, or rubric-based assessment. Preserve the user's workflow philosophy instead of normalizing every decision into the same node type.

### 2. Replace fake commands

For every fake checker in the prototype:

- preserve CLI shape such as `--run-dir`
- preserve output artifact names unless there is a strong reason to change them
- write machine-readable JSON before returning a failing exit code
- preserve feedback routing into persistent agent sessions unless the workflow contract intentionally changes

Fake commands are expected in prototypes. They are placeholders that prove graph behavior, retry behavior, artifact contracts, and runner interaction. They are not acceptable as production validators.

Minimum gate result fields:

- `gateId`
- `ok`
- `reason`
- `route`
- `checkedArtifacts`

### 3. Wire real artifacts

The production repository must decide:

- who writes `artifacts/input.json`
- where stage outputs live
- where prompt, stdout, stderr, and result are persisted
- how selected artifacts are recorded for replay

Do not let artifact selection live only in chat history. The runner must persist it.

### 4. Keep prompt assembly deterministic

The runner should assemble prompts from `handoff-manifest.json`, not from previous-agent prose.

The production repository should:

- load the stage prompt template from `targetStage.promptTemplate`
- inject artifacts in `injection.renderOrder`
- keep stage prompts fixed per agent role
- treat handoff notes as runtime state, not generated prompts
- fail fast when a required artifact is missing
- record the selected artifact list for debugging

### 5. Add replay and debug entrypoints

Before enabling full-loop runs, add commands that can:

- replay one stage from a saved run directory
- run one checker in isolation
- list persistent sessions or the transport-specific equivalent for that run
- inspect persisted prompt, stdout, stderr, and result artifacts
- diff two attempts of the same stage

Without replay, failed loops will be slow to diagnose.

The prototype runner is a starting point for this work. It should already prove startup, persistent fake sessions, prompt assembly from manifests, replay controls, and durable local persistence. If production uses OpenCode, copy either `opencode-http-session/python/` or `opencode-http-session/typescript/` first, then specialize only the production gates, domain path placeholders, and environment-specific execution concerns.

### 6. Preserve persistent sessions

Production runners should keep one session per long-lived agent role, such as `plan`, `codegen`, `optimize`, and `review`.

They should also preserve a stable session-observability surface. In simple prototypes this may be a `sessions` replay command plus a generated debug-guide artifact. In real transports it may become HTTP session inspection, server-owned session records, or attach-style client commands. The transport can change; the need for a discoverable observer surface should not.

When an external gate fails, the runner should inject:

- the gate result artifact
- the fixed continuation message, such as `检验不通过的，请继续修改代码。`
- the current run context needed to continue safely

Then the runner should resume the same agent session rather than starting a replacement repair agent.

### 7. Add environment integration

Production repositories must wire environment-specific concerns the kit does not own:

- reference implementation paths
- datasets or fixtures
- benchmark harnesses
- dependency bootstrap
- CI or local execution entrypoints
- logging and metrics sinks

## Expected Output

At the end of adaptation, the production repository should have:

- a preserved workflow graph
- real correctness, perf, and finalize commands
- runtime-generated input and stage artifacts
- replayable prompt and result persistence
- debuggable logs and isolated stage entrypoints

## Common Mistakes

| Mistake | Fix |
|---|---|
| Rewriting the graph while replacing fake commands | Keep the graph stable; swap adapters first |
| Discarding the prototype runner contract | Preserve the startup, replay, and persistent-session behavior while replacing the adapters |
| Removing fake gates instead of replacing them | Keep the node and replace the command implementation |
| Changing result JSON while replacing fake gates | Preserve the prototype result schema unless the contract intentionally changes |
| Splitting one persistent worker into repair agents after gate failure | Resume the same session through a feedback node |
| Modeling every judgment as an agent | Use command gates for hard checks unless the workflow calls for qualitative judgment |
| Letting the runner improvise the next prompt | Assemble prompts from `handoff-manifest.json` only |
| Returning only shell exit codes from gates | Persist machine-readable gate JSON before exit |
| Running the full loop before stage replay exists | Add single-stage and single-gate replay first |
| Treating sample artifacts as production truth | Replace them with runtime-generated inputs and evidence |
