import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

export async function seedRunDirectory(input: {
  readonly canonicalRunRoot: string
  readonly freshRun: boolean
  readonly freshRunMarker: string
  readonly runDirectory: string
  readonly seedArtifacts: readonly string[]
  readonly workflowDirectory: string
}): Promise<void> {
  if (input.freshRun && (await Bun.file(input.runDirectory).exists())) {
    await ensureSafeFreshRun(input.runDirectory, input.freshRunMarker, input.canonicalRunRoot)
    await rm(input.runDirectory, { force: true, recursive: true })
  }

  for (const relativePath of input.seedArtifacts) {
    const sourcePath = join(input.workflowDirectory, relativePath)
    const targetPath = join(input.runDirectory, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
  }

  await writeText(join(input.runDirectory, input.freshRunMarker), "prototype-run-owned\n")
}

export async function clearPaths(runDirectory: string, relativePaths: readonly string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    await rm(join(runDirectory, relativePath), { force: true, recursive: true })
  }
}

export async function readJsonObject<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp`
  await writeFile(tempPath, JSON.stringify(value, null, 2))
  await rename(tempPath, path)
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  const prefix = (await Bun.file(path).exists()) ? `${await readFile(path, "utf8")}` : ""
  await writeText(path, `${prefix}${JSON.stringify(value)}\n`)
}

async function ensureSafeFreshRun(runDirectory: string, markerName: string, canonicalRunRoot: string): Promise<void> {
  const resolvedRunDirectory = resolve(runDirectory)
  const resolvedCanonicalRoot = resolve(canonicalRunRoot)
  const markerPath = join(runDirectory, markerName)
  const insideCanonicalRoot = resolvedRunDirectory === resolvedCanonicalRoot || resolvedRunDirectory.startsWith(`${resolvedCanonicalRoot}/`)
  if (!insideCanonicalRoot) {
    throw new Error(`Refusing fresh run outside canonical prototype root: ${runDirectory}`)
  }
  if (!(await Bun.file(markerPath).exists())) {
    throw new Error(`Refusing fresh run for unowned directory: ${runDirectory}`)
  }
}
