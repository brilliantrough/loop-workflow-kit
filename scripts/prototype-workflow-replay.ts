import { resolve } from "node:path"

import { inspectRunDirectory, inspectSessions, replayGate, replayStage } from "./runtime/prototype-runner-core"

const argv = process.argv.slice(2)
const workflowPath = resolve(process.cwd(), readOption(argv, "--workflow", "workflows/operator-dsl-loop/workflow.yml"))
const mode = readOption(argv, "--mode", "inspect")
const runDirectory = resolve(process.cwd(), readOption(argv, "--run-dir", ".runs/operator-dsl-loop/layer-norm-operator-dsl"))

if (mode === "stage") {
  const stageId = readRequiredOption(argv, "--stage")
  await replayStage({ runDirectory, stageId, workflowPath })
  process.exit(0)
}

if (mode === "gate") {
  const gateId = readRequiredOption(argv, "--gate")
  process.exit(await replayGate({ gateId, runDirectory, workflowPath }))
}

if (mode === "sessions") {
  console.log(await inspectSessions({ runDirectory }))
  process.exit(0)
}

console.log(await inspectRunDirectory({ runDirectory }))

function readOption(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(name)
  const value = argv[index + 1]
  if (index === -1 || value === undefined) {
    return fallback
  }
  return value
}

function readRequiredOption(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name)
  const value = argv[index + 1]
  if (index === -1 || value === undefined) {
    throw new Error(`Missing ${name}`)
  }
  return value
}
