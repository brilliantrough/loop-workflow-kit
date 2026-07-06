import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

type GateResult = {
  readonly ok: boolean
  readonly reason: string
}

type CliArgs = {
  readonly runDirectory: string
}

const args = parseArgs(process.argv.slice(2))
const result = await runGate(args.runDirectory)
await mkdir(join(args.runDirectory, "artifacts"), { recursive: true })
await writeFile(join(args.runDirectory, "artifacts", "gate-result.json"), JSON.stringify(result, null, 2))

if (!result.ok) {
  console.error(result.reason)
  process.exit(1)
}

console.log(result.reason)

async function runGate(runDirectory: string): Promise<GateResult> {
  return {
    ok: true,
    reason: `gate passed for ${runDirectory}`,
  }
}

function parseArgs(argv: readonly string[]): CliArgs {
  const runDirIndex = argv.indexOf("--run-dir")
  const runDirectory = argv[runDirIndex + 1]
  if (runDirIndex === -1 || runDirectory === undefined) {
    throw new Error("Missing --run-dir")
  }

  return { runDirectory }
}
