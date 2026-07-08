import { dirname, resolve } from "node:path"

import { deriveRunDirectory } from "./runtime/contracts"
import { runPrototypeWorkflow } from "./runtime/prototype-runner-core"

const rootDirectory = process.cwd()
const workflowPath = resolve(rootDirectory, readOption(process.argv.slice(2), "--workflow", "workflows/operator-dsl-loop/workflow.yml"))
const workflowDirectory = dirname(workflowPath)
const freshRun = process.argv.includes("--fresh-run")
const explicitRunDirectory = readOptionalOption(process.argv.slice(2), "--run-dir")
const runDirectory = await deriveRunDirectory(rootDirectory, workflowDirectory, explicitRunDirectory)

console.log(`[prototype-runner] workflow=${workflowPath}`)
console.log(`[prototype-runner] runDirectory=${runDirectory}`)
console.log("[prototype-runner] session-capable fake runtime mode")

process.exit(await runPrototypeWorkflow({ freshRun, runDirectory, workflowPath }))

function readOption(argv: readonly string[], name: string, fallback: string): string {
  const value = readOptionalOption(argv, name)
  return value ?? fallback
}

function readOptionalOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  const value = argv[index + 1]
  if (index === -1 || value === undefined) {
    return undefined
  }
  return value
}
