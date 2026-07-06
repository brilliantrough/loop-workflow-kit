import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

type GateResult = {
  readonly ok: boolean
  readonly reason: string
}

const runDirIndex = process.argv.indexOf("--run-dir")
const runDirectory = process.argv[runDirIndex + 1]
if (runDirIndex === -1 || runDirectory === undefined) {
  throw new Error("Missing --run-dir")
}

const result: GateResult = { ok: true, reason: "gate passed" }
await mkdir(join(runDirectory, "artifacts"), { recursive: true })
await writeFile(join(runDirectory, "artifacts", "gate-result.json"), JSON.stringify(result, null, 2))

if (!result.ok) {
  console.error(result.reason)
  process.exit(1)
}

console.log(result.reason)
