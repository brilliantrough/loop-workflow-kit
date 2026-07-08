import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"

type ScaffoldArgs = {
  readonly force: boolean
  readonly name: string
  readonly rootDirectory: string
  readonly workflowDirectory: string
}

type RenderContext = {
  readonly freshRunMarker: string
  readonly runRoot: string
  readonly sampleRunDirectory: string
  readonly sampleRunId: string
  readonly workflowName: string
  readonly workflowPath: string
}

const args = parseArgs(process.argv.slice(2))
const workflowPath = join(args.workflowDirectory, "workflow.yml")
const render = makeRenderContext(args.rootDirectory, args.name, workflowPath)

await ensureWritableTarget(args)
await mkdir(args.workflowDirectory, { recursive: true })
await writeRenderedFile({
  render,
  sourcePath: join(args.rootDirectory, "templates", "workflows", "graph-workflow.yaml"),
  targetPath: workflowPath,
  transform: renderWorkflowTemplate,
})
await writeRenderedFile({
  render,
  sourcePath: join(args.rootDirectory, "templates", "artifacts", "handoff-manifest.json"),
  targetPath: join(args.workflowDirectory, "handoff-manifest.json"),
  transform: renderManifestTemplate,
})
await copyRenderedTree({
  render,
  baseSourceRoot: join(args.rootDirectory, "templates", "workflow-seed"),
  sourceRoot: join(args.rootDirectory, "templates", "workflow-seed"),
  targetRoot: args.workflowDirectory,
})

console.log(`[scaffold] workflow=${args.name}`)
console.log(`[scaffold] directory=${args.workflowDirectory}`)
console.log(`[scaffold] startup=bun run prototype:run -- --workflow ${render.workflowPath}`)
console.log(`[scaffold] replay=bun run prototype:replay -- --workflow ${render.workflowPath} --mode inspect --run-dir ${render.sampleRunDirectory}`)

function parseArgs(argv: readonly string[]): ScaffoldArgs {
  const rootDirectory = process.cwd()
  const name = readRequiredOption(argv, "--name")
  const workflowDirectory = resolve(rootDirectory, readOption(argv, "--workflow-dir", join("workflows", name)))
  return {
    force: argv.includes("--force"),
    name,
    rootDirectory,
    workflowDirectory,
  }
}

async function ensureWritableTarget(args: ScaffoldArgs): Promise<void> {
  const exists = await pathExists(args.workflowDirectory)
  if (!exists) {
    return
  }
  if (!args.force) {
    throw new Error(`Refusing to overwrite existing workflow directory: ${args.workflowDirectory}. Re-run with --force if replacement is intended.`)
  }
  await rm(args.workflowDirectory, { force: true, recursive: true })
}

function makeRenderContext(rootDirectory: string, workflowName: string, workflowPath: string): RenderContext {
  const sampleTargetArtifact = "generated/output.txt"
  const sampleTargetBackend = "prototype-backend"
  const runRoot = `.runs/${workflowName}`
  return {
    freshRunMarker: `.${workflowName}-run`,
    runRoot,
    sampleRunDirectory: `${runRoot}/${sanitizeSlug(sampleTargetArtifact)}--${sanitizeSlug(sampleTargetBackend)}`,
    sampleRunId: `${workflowName}-sample-run`,
    workflowName,
    workflowPath: normalizePath(relative(rootDirectory, workflowPath) || workflowPath),
  }
}

async function writeRenderedFile(input: {
  readonly render: RenderContext
  readonly sourcePath: string
  readonly targetPath: string
  readonly transform?: (raw: string, render: RenderContext) => string
}): Promise<void> {
  const raw = await readFile(input.sourcePath, "utf8")
  const rendered = (input.transform ?? replaceTemplateTokens)(raw, input.render)
  await mkdir(dirname(input.targetPath), { recursive: true })
  await writeFile(input.targetPath, rendered)
}

async function copyRenderedTree(input: {
  readonly baseSourceRoot: string
  readonly render: RenderContext
  readonly sourceRoot: string
  readonly targetRoot: string
}): Promise<void> {
  const entries = await readdir(input.sourceRoot, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = join(input.sourceRoot, entry.name)
    const targetRelativePath = mapSeedRelativePath(normalizePath(relative(input.baseSourceRoot, sourcePath)))
    const targetPath = join(input.targetRoot, targetRelativePath)
    if (entry.isDirectory()) {
      await copyRenderedTree({
        baseSourceRoot: input.baseSourceRoot,
        render: input.render,
        sourceRoot: sourcePath,
        targetRoot: input.targetRoot,
      })
      continue
    }
    await writeRenderedFile({
      render: input.render,
      sourcePath,
      targetPath,
    })
  }
}

function mapSeedRelativePath(relativePath: string): string {
  return relativePath
    .replace("checks/fake-correctness.ts", "checks/correctness.ts")
    .replace("checks/fake-perf.ts", "checks/perf.ts")
    .replace("checks/fake-finalize.ts", "checks/finalize.ts")
}

function renderWorkflowTemplate(raw: string, render: RenderContext): string {
  return replaceTemplateTokens(
    raw
      .replaceAll("example-loop", render.workflowName)
      .replaceAll(".runs/example-loop", render.runRoot)
      .replaceAll(".example-loop-run", render.freshRunMarker)
      .replaceAll("workflows/example-loop/workflow.yml", render.workflowPath),
    render,
  )
}

function renderManifestTemplate(raw: string, render: RenderContext): string {
  return replaceTemplateTokens(
    raw
      .replaceAll("example-loop", render.workflowName)
      .replaceAll(".runs/example-loop", render.runRoot)
      .replaceAll(".example-loop-run", render.freshRunMarker),
    render,
  )
}

function replaceTemplateTokens(raw: string, render: RenderContext): string {
  return raw
    .replaceAll("__WORKFLOW_NAME__", render.workflowName)
    .replaceAll("__WORKFLOW_PATH__", render.workflowPath)
    .replaceAll("__RUN_ROOT__", render.runRoot)
    .replaceAll("__FRESH_RUN_MARKER__", render.freshRunMarker)
    .replaceAll("__SAMPLE_RUN_DIRECTORY__", render.sampleRunDirectory)
    .replaceAll("__SAMPLE_RUN_ID__", render.sampleRunId)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function readOption(argv: readonly string[], name: string, fallback: string): string {
  const value = readOptionalOption(argv, name)
  return value ?? fallback
}

function readRequiredOption(argv: readonly string[], name: string): string {
  const value = readOptionalOption(argv, name)
  if (value === undefined) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function readOptionalOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  const value = argv[index + 1]
  if (index === -1 || value === undefined) {
    return undefined
  }
  return value
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}

function sanitizeSlug(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "run"
}
