import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

type CliArgs = {
  readonly runDirectory: string
}

const args = parseArgs(process.argv.slice(2))
await mkdir(join(args.runDirectory, "artifacts"), { recursive: true })
await writeFile(
  join(args.runDirectory, "artifacts", "finalize.json"),
  JSON.stringify(
    {
      published: false,
      reason: "prototype finalize step recorded; production repo should replace this with a real export or registration action",
    },
    null,
    2,
  ),
)
console.log("fake finalize recorded")

function parseArgs(argv: readonly string[]): CliArgs {
  const runDirIndex = argv.indexOf("--run-dir")
  const runDirectory = argv[runDirIndex + 1]
  if (runDirIndex === -1 || runDirectory === undefined) {
    throw new Error("Missing --run-dir")
  }

  return { runDirectory }
}
