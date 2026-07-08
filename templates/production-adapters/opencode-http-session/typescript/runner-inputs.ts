import { copyFile, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { readJsonObject, writeText } from "./json-store"

export async function resolveRunDirectory(input: {
  readonly deriveFromInput: string
  readonly explicitRunDirectory?: string
  readonly inputArtifact: string
  readonly repoRoot: string
  readonly runRoot: string
  readonly workflowRoot: string
}): Promise<string> {
  if (input.explicitRunDirectory !== undefined) {
    return resolve(input.explicitRunDirectory)
  }
  const payload = await readJsonObject(join(input.workflowRoot, input.inputArtifact))
  const fields = input.deriveFromInput.split("+").map((field) => field.trim()).filter((field) => field.length > 0)
  if (fields.length === 0) {
    throw new Error("runtime.runDirectory.deriveFromInput must name at least one input field")
  }
  const slug = fields.map((field) => sanitizeSegment(readRequiredString(payload, field))).join("--")
  return resolve(input.runRoot, slug)
}

export async function prepareRunDirectory(input: {
  readonly freshRun: boolean
  readonly markerName: string
  readonly runDirectory: string
  readonly runRoot: string
  readonly seedArtifacts: readonly string[]
  readonly workflowRoot: string
}): Promise<void> {
  if (input.freshRun && (await Bun.file(input.runDirectory).exists())) {
    await ensureSafeFreshRun(input.runDirectory, input.runRoot, input.markerName)
    await rm(input.runDirectory, { force: true, recursive: true })
  }
  for (const relativePath of input.seedArtifacts) {
    const source = join(input.workflowRoot, relativePath)
    const target = join(input.runDirectory, relativePath)
    if (!(await Bun.file(source).exists())) {
      throw new Error(`seed artifact does not exist: ${source}`)
    }
    await Bun.$`mkdir -p ${dirname(target)}`.quiet()
    await copyFile(source, target)
  }
  await writeText(join(input.runDirectory, input.markerName), "opencode-http-session\n")
}

async function ensureSafeFreshRun(runDirectory: string, runRoot: string, markerName: string): Promise<void> {
  const resolvedRunDirectory = resolve(runDirectory)
  const resolvedRunRoot = resolve(runRoot)
  const insideRunRoot = resolvedRunDirectory === resolvedRunRoot || resolvedRunDirectory.startsWith(`${resolvedRunRoot}/`)
  if (insideRunRoot || (await Bun.file(join(runDirectory, markerName)).exists())) {
    return
  }
  throw new Error(`refusing --fresh-run outside canonical run root without runner marker: ${runDirectory}`)
}

function readRequiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`input artifact is missing non-empty string field: ${key}`)
  }
  return value
}

function sanitizeSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^[._-]+|[._-]+$/g, "") || "run"
}
