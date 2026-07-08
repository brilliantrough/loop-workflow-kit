import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

type CliArgs = {
  readonly runDirectory: string
}

const args = parseArgs(process.argv.slice(2))
await mkdir(join(args.runDirectory, "artifacts"), { recursive: true })
const markerPath = join(args.runDirectory, "artifacts", "fake-correctness-attempt.txt")
const nextAttempt = await readAttempt(markerPath)

await writeFile(
  join(args.runDirectory, "artifacts", "correctness.json"),
  JSON.stringify(
    {
      attempt: nextAttempt,
      checkedArtifacts: ["generated/output.txt", "artifacts/codegen-report.md"],
      gateId: "correctness",
      ok: nextAttempt > 1,
      reason:
        nextAttempt > 1
          ? "prototype correctness gate passed after one repair"
          : "prototype correctness gate failed on the first attempt",
      route: nextAttempt > 1 ? "pass" : "fail",
    },
    null,
    2,
  ),
)
await writeFile(markerPath, String(nextAttempt))

if (nextAttempt === 1) {
  console.error("fake correctness failed on first attempt")
  process.exit(1)
}

console.log("fake correctness passed")

function parseArgs(argv: readonly string[]): CliArgs {
  const runDirIndex = argv.indexOf("--run-dir")
  const runDirectory = argv[runDirIndex + 1]
  if (runDirIndex === -1 || runDirectory === undefined) {
    throw new Error("Missing --run-dir")
  }

  return { runDirectory }
}

async function readAttempt(path: string): Promise<number> {
  if (!(await Bun.file(path).exists())) {
    return 1
  }

  const rawValue = await readFile(path, "utf8")
  const parsed = Number(rawValue.trim())
  return Number.isFinite(parsed) ? parsed + 1 : 1
}
