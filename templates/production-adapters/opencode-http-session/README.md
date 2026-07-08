# OpenCode HTTP Session Adapter

This template directory exists so a workflow migrated out of `loop-workflow-kit` does not need to rediscover how to talk to `opencode serve`.

## What It Covers

- health-check and session/message HTTP calls for an OpenCode server
- server bootstrap with `opencode serve --hostname ... --port ... --print-logs`
- durable per-stage session persistence
- runtime-state persistence for inspect/replay surfaces
- generic `runner.py` / `runner_replay.py` templates that consume `workflow.yml` + `handoff-manifest.json`
- generic `runner.ts` / `runner-replay.ts` templates for TypeScript/Bun production repositories
- generated `artifacts/opencode-attach-commands.txt` so a human can attach to each persisted session
- workflow `runtime:` snippets that switch a prototype workflow from `fake-session` to `opencode-http-session`

## What It Does Not Cover

- advanced repository-specific prompt enrichment beyond the manifest contract
- your correctness/perf/finalize gate commands
- domain-specific output placeholders such as backend implementation paths

Those parts still belong in the target repository, but they should extend this adapter instead of rethinking the transport seam.

## Recommended Migration Path

1. Copy `workflow.yml`, `handoff-manifest.json`, prompts, and gate contracts from the prototype workflow.
2. Choose the production adapter language.
3. Replace the prototype `runtime.runner` surface with `workflow-runtime.python.snippet.yaml` or `workflow-runtime.typescript.snippet.yaml`.
4. Copy either `python/` or `typescript/` into the production workflow directory.
5. Keep the generic runner/replay first, then specialize only path placeholders or environment hooks that the target repository truly needs.
6. Replace fake gates with real correctness/perf/finalize commands.

## Adapter Choice

Use the Python adapter when the production repository is already Python-first, depends on Python checkers, or wants direct alignment with Python SDK/runtime code.

Use the TypeScript/Bun adapter when the production repository already runs Bun, wants to share TypeScript gate/checker code, or prefers a single JS/TS orchestration stack.

Both adapters implement the same OpenCode runtime contract:

- start or reuse `opencode serve`
- create or resume one session per workflow role
- submit prompts via `/session/{id}/prompt_async`
- persist session ids and runtime state under `artifacts/`
- write attach commands to `artifacts/opencode-attach-commands.txt`
- expose inspect, sessions, stage replay, and gate replay commands

## Runtime Model

The intended model is:

- one long-lived `opencode serve` process owns execution
- one persistent session per long-lived workflow role such as `plan`, `codegen`, `optimize`, and `review`
- the runner submits prompts against those sessions
- replay and debug surfaces inspect the persisted session ids instead of guessing

## Files

- `workflow-runtime.snippet.yaml`
- `workflow-runtime.python.snippet.yaml`
- `workflow-runtime.typescript.snippet.yaml`
- `python/contracts.py`
- `python/opencode_http.py`
- `python/opencode_server.py`
- `python/prompt_assembly.py`
- `python/runner.py`
- `python/runner_cli.py`
- `python/runner_inputs.py`
- `python/runner_replay.py`
- `python/session_store.py`
- `typescript/contracts.ts`
- `typescript/json-store.ts`
- `typescript/opencode-http.ts`
- `typescript/opencode-server.ts`
- `typescript/prompt-assembly.ts`
- `typescript/runner.ts`
- `typescript/runner-cli.ts`
- `typescript/runner-inputs.ts`
- `typescript/runner-replay.ts`
- `typescript/session-store.ts`

## Language Boundary

The kit's root TypeScript/Bun code is the prototype authoring layer: scaffolding, fake sessions, fake gates, contract tests, and fast local replay. The adapter subdirectories are production runtime choices: `python/` for Python-first repositories and `typescript/` for TypeScript/Bun-first repositories.

The shared surface is not runtime code. The shared surface is the workflow contract:

- `workflow.yml`
- `handoff-manifest.json`
- `artifacts/input.json`
- gate result JSON
- review decision JSON
- stage required-output paths
