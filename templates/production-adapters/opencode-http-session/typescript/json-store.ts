import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

export async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected JSON object: ${path}`)
  }
  return value as Record<string, unknown>
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`, { flag: "a" })
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true })
}
