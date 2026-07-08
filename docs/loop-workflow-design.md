# Loop Workflow Design

This kit treats a loop workflow as a graph of bounded execution nodes.

## Design Goals

- Make stage routing explicit in YAML.
- Keep pass/fail decisions outside agent self-reporting.
- Move context through artifacts and prompt assembly rather than hidden chat history.
- Keep domain-specific checkers replaceable.
- Give every workflow prototype a concrete startup command through a session-capable prototype runner.

## Workflow Graph

Each workflow has an `entry` node and a `nodes` map. Nodes route through `next`, `pass`, and `fail`. Agent nodes may declare a stable `session`; feedback nodes use that session to continue the same agent instead of starting a new one.

Every generated workflow should also include a runner surface. In prototype repositories, this should be a session-capable prototype runner that reads the graph, seeds a canonical run directory, creates or resumes fake persistent sessions, assembles prompts from a handoff manifest, executes fake command/gate nodes, and exposes concrete startup plus replay commands such as `bun run prototype:run -- --workflow workflows/<name>/workflow.yml`. The prototype runner is part of prototype completeness because it proves how the graph is started, how sessions continue, how prompts are assembled, and where production adapters must be inserted.

Inside this repository, a practical authoring flow is:

1. `bun run scaffold:workflow -- --name <workflow-name>`
2. refine the generated `workflow.yml`, `handoff-manifest.json`, prompts, and fake checks
3. validate the prototype with `prototype:run` and `prototype:replay`

The replay surface should cover at least four commands:

1. inspect the persisted run directory
2. list persisted sessions for that run
3. replay one stage
4. replay one gate

Production adaptation may later replace `sessions` with a richer transport-specific observer such as HTTP session inspection or `opencode attach`, but the framework should always expose a stable session-observability surface.

When the target runtime uses OpenCode, the kit already provides Python and TypeScript/Bun production adapter skeletons at `templates/production-adapters/opencode-http-session/`. New production migrations should start there instead of rebuilding server bootstrap, session persistence, attach-command generation, prompt rendering, and replay commands from scratch.

```yaml
name: operator-dsl-loop
entry: plan
nodes:
  plan:
    kind: agent
    engine: opencode
    session: plan
    prompt: prompts/operator-plan.md
    next: codegen
  correctness:
    kind: gate
    command: ["bun", "run", "checks/correctness.ts", "--run-dir", "{{runDirectory}}"]
    pass: optimize
    fail: codegen_feedback

  codegen_feedback:
    kind: agent_feedback
    session: codegen
    inject:
      artifacts: ["artifacts/correctness.json"]
      message: "检验不通过的，请继续修改代码。"
    next: correctness
```

The expected operator loop uses four persistent agent sessions: `plan`, `codegen`, `optimize`, and `review`. The correctness and performance checks are external command/gate nodes. When a command fails, the runner injects the command output into the matching persistent agent session and continues that same session.

## Handoff Contract

Each `agent` node owns a fixed stage prompt. Treat that prompt as the stage system prompt: it should explain the full workflow at a high level, then give strict instructions for the current stage.

The previous agent must not write the next agent's prompt. It should emit structured artifacts plus a handoff note that explains the work state for the next stage. The runner should then assemble the next prompt from a fixed prompt template plus selected artifacts, using a `handoff-manifest.json` contract.

The manifest should contain:

1. `run` — workflow name, the root input artifact, canonical run-directory policy, and seed artifacts
2. `sourceStage` — who produced this handoff
3. `targetStage` — target role, prompt template, required outputs, stop condition
4. `injection` — ordered prompt sections and artifact references
5. `persistence` — audit records such as selected artifact lists
6. `routing` — default next node on success or failure
7. `clearOnEnter` / `requiredOutputs` — stage freshness and completion contract

The runner should not guess prompt composition. It should follow `injection.renderOrder` exactly.

Prompt assembly should pull from:

1. run input
2. stage prompt template
3. previous stage handoff text
4. selected artifacts
5. previous stage output
6. required outputs and stop conditions

The run-directory policy should support more than toy `runId` naming. In practice, reusable workflows often need a stable slug built from multiple input fields, such as `operatorDir + backend` or `targetArtifact + targetBackend`, so the framework contract should permit multi-field run-slug derivation instead of assuming a single `runId` is always the right identity surface.

## Agent Wakeup

An `agent` node wakes an agent by assembling the fixed stage prompt and invoking a selected engine such as `opencode` or `codex`. The prompt should state the workflow overview, the current stage role, required inputs, required outputs, and hard rules. The workflow owns routing and retry policy.

Agents should know the workflow shape, but they should not coordinate by chatting with each other. They coordinate through persisted artifacts and handoff notes. The runner owns artifact injection and route selection.

Some workflow edges continue an existing agent session. For example, the correctness gate can fail after `codegen` stops. In that case the runner injects the gate output plus the fixed message `检验不通过的，请继续修改代码。` into the existing `codegen` session and resumes it. This prevents an agent from stopping early while still keeping the gate decision outside agent self-reporting.

## Gate Nodes

Use `gate` nodes for correctness, performance, policy, and review validation. A gate should write a result artifact before returning its process exit code.

Judgment nodes are a workflow-design decision, not a fixed implementation type. Most hard pass/fail checks should be external commands, usually bash-compatible scripts or binaries, because they keep the decision outside agent self-reporting. A judgment node may also be an agent when the workflow intentionally wants qualitative review, rubric scoring, or human-like assessment. Choose the node type from the user's workflow philosophy instead of inventing extra agent stages.

During prototype design, command-style judgment nodes may use fake bash-compatible scripts as placeholders. A fake gate is valid when it proves routing, retry, artifact shape, and runner interaction without pretending to be a production validator. It must be named and documented as fake, preserve the future production CLI shape, and write the same machine-readable result fields that the real gate will write later.

Fake gates are prototype adapters, not production checks. Production migration should replace them with real commands while preserving node ids, artifact names, result schema, and feedback routing unless the runner contract intentionally changes.

Do not split a failed command gate into a new repair agent by default. If the intended worker is a persistent agent session, route failure to a feedback/continuation node that injects the gate result back into that same session. This keeps the agent role stable and prevents accidental workflow fragmentation.

Minimum gate result fields:

- `gateId`
- `ok`
- `reason`
- `route`
- `checkedArtifacts`

The agent immediately before a gate should usually try to run the same validation before stopping. The separate gate still exists as an enforcement point so the workflow does not trust agent self-reporting.

## Review Loops

Review nodes should return structured results such as `review-result.json`.

Minimum review result sections:

- `decision`: approved, route, severity, reason
- `feedback`: summary, required plan changes, required local fixes, carry-forward artifacts
- `routing`: next node and optional handoff manifest path

A failed review can route back to `plan` when strategy changes, or to `repair` when the implementation needs a local correction.

For this prototype, review is an agent decision parsed by the runner. The canonical routing signal is the structured field `decision.approved === true`; the approval signal `合格` remains a human-readable requirement in the review artifact and prompt contract. If `decision.approved` is false, the runner injects `review-result.json` and `review-notes.md` back into the persistent `plan` session and restarts the loop from planning.

## Prototype vs Production

This kit stops at environment-specific adapters. A prototype-complete workflow in this repository should include:

- a graph with explicit retry and review routing
- a session-capable prototype runner with documented startup and replay commands
- an inspectable session surface plus a generated per-run debug guide
- prompt templates that state stage roles and required outputs
- a handoff manifest that the runner actually consumes
- persistent fake sessions, prompt persistence, selected-artifact persistence, and replayable state
- sample handoff and review artifacts that show the runner contracts
- machine-readable gate outputs, even when the checker itself is fake
- rule artifacts that future runners can inject into prompts

It should not include real production engine adapters, production build wiring, benchmark harnesses, or deployment-specific shell logic.

Those belong in the target production repository. That repository must own:

- real correctness and performance commands
- actual reference implementation paths and datasets
- environment-specific run directory policy, sandbox policy, and dependency bootstrap
- stdout/stderr/result shipping beyond the prototype persistence already proven here
- environment-specific observability, metrics sinks, and auth concerns

Use the production-adaptation skill when moving a packaged workflow into a real runtime repository.

## Language Responsibilities

This repository intentionally keeps the workflow language independent from the runtime implementation language.

TypeScript/Bun is the kit's design-time stack. It should remain responsible for generating prototype workflows, running fake-session loops, proving prompt/gate contracts, and validating examples with fast local tests.

Python is the production adapter stack when a target workflow repository is Python-first. It should own real OpenCode HTTP sessions, process bootstrap, runtime-state persistence, attach-command output, and integration with production checkers.

TypeScript/Bun can also be the production adapter stack when a target workflow repository is Bun-first. It owns the same OpenCode session, replay, attach, and gate-execution responsibilities as the Python adapter, while keeping orchestration and checker code in TypeScript.

The production adapters are therefore interchangeable through artifacts and contracts, not by importing each other's runtime code.

## Operator DSL Example

The packaged `workflows/operator-dsl-loop/` uses fake checkers to demonstrate framework behavior. It is still prototype-complete because it also packages the rule artifacts, handoff contract, review contract, and finalize path that downstream repositories are expected to preserve.

In a target server repository, replace the fake commands with real PyTorch-reference correctness and performance tooling, replace the fake session adapter with the real engine/session transport, keep the artifact contracts stable, and add repository-specific logging and environment integration.
