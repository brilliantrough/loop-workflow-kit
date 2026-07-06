import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

type CliArgs = {
  readonly runDirectory: string
}

const args = parseArgs(process.argv.slice(2))
await mkdir(join(args.runDirectory, "artifacts"), { recursive: true })
await writeFile(
  join(args.runDirectory, "artifacts", "perf.json"),
  JSON.stringify(
    {
      baselineMs: 10.5,
      candidateMs: 7.4,
      bottleneck: "mock memory bound loop",
      checkedArtifacts: ["generated/operator.dsl", "artifacts/codegen-report.md"],
      gateId: "perf",
      ok: true,
      reason: "prototype performance gate met the target",
      route: "pass",
      speedup: 1.42,
      targetMet: true,
    },
    null,
    2,
  ),
)
console.log("fake perf passed")

function parseArgs(argv: readonly string[]): CliArgs {
  const runDirIndex = argv.indexOf("--run-dir")
  const runDirectory = argv[runDirIndex + 1]
  if (runDirIndex === -1 || runDirectory === undefined) {
    throw new Error("Missing --run-dir")
  }

  return { runDirectory }
}
