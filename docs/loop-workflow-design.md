# Loop Workflow Design

This kit treats a loop workflow as a graph of bounded execution nodes.

## Design Goals

- Make stage routing explicit in YAML.
- Keep pass/fail decisions outside agent self-reporting.
- Move context through artifacts and prompt assembly rather than hidden chat history.
- Keep domain-specific checkers replaceable.

## Workflow Graph

Each workflow has an `entry` node and a `nodes` map. Nodes route through `next`, `pass`, and `fail`.

```yaml
name: operator-dsl-loop
entry: plan
nodes:
  plan:
    kind: agent
    engine: opencode
    prompt: prompts/operator-plan.md
    next: codegen
  correctness:
    kind: gate
    command: ["bun", "run", "checks/correctness.ts", "--run-dir", "{{runDirectory}}"]
    pass: perf
    fail: repair_correctness
```

## Handoff Contract

The previous agent should not freely invent the next agent prompt. It should emit structured artifacts. The runner should then assemble the next prompt from:

1. run input
2. stage prompt template
3. selected artifacts
4. previous stage output
5. required outputs and stop conditions

## Agent Wakeup

An `agent` node wakes an agent by assembling a stage prompt and invoking a selected engine such as `opencode` or `codex`. The node itself should state the role and output contract; the workflow owns routing and retry policy.

## Gate Nodes

Use `gate` nodes for correctness, performance, policy, and review validation. A gate should write a result artifact before returning its process exit code.

## Review Loops

Review nodes should return structured results such as `review-result.json`. A failed review can route back to `plan` when strategy changes, or to `repair` when the implementation needs a local correction.

## Operator DSL Example

The packaged `workflows/operator-dsl-loop/` uses fake checkers to demonstrate framework behavior. In a target server repository, replace those scripts with real PyTorch-reference correctness and performance tooling.
