import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export type InjectionSection = {
  readonly artifact?: string
  readonly label: string
  readonly promptTemplate?: true
  readonly required: boolean
}

export type StageContract = {
  readonly clearOnEnter: readonly string[]
  readonly continuationMessage?: string
  readonly injection: {
    readonly renderOrder: readonly string[]
    readonly sections: readonly InjectionSection[]
  }
  readonly persistence: {
    readonly selectedArtifactsRecord: string
  }
  readonly promptTemplate: string
  readonly prototypeOutputs: readonly string[]
  readonly requiredOutputs: readonly string[]
  readonly routing: {
    readonly onFailure?: string
    readonly onSuccess: string
  }
  readonly session: string
}

export type GateContract = {
  readonly command: readonly string[]
  readonly fail?: string
  readonly maxAttempts?: number
  readonly pass?: string
  readonly resultArtifact: string
}

export type WorkflowManifest = {
  readonly decision: {
    readonly approvalSignal: string
    readonly artifact: string
    readonly equals: boolean
    readonly jsonPath: readonly string[]
  }
  readonly gates: Record<string, GateContract>
  readonly run: {
    readonly defaultRunDirectoryRoot: string
    readonly freshRunMarker: string
    readonly inputArtifact: string
    readonly runIdField?: string
    readonly runSlugFromFields?: readonly string[]
    readonly seedArtifacts: readonly string[]
    readonly workflowName: string
    readonly workflowVersion: string
  }
  readonly sessions: Record<string, { readonly agent: string; readonly engine: string }>
  readonly stages: Record<string, StageContract>
}

export type WorkflowInput = Record<string, unknown>

export async function loadManifest(workflowDirectory: string): Promise<WorkflowManifest> {
  const raw = JSON.parse(await readFile(join(workflowDirectory, "handoff-manifest.json"), "utf8"))
  if (!isRecord(raw)) {
    throw new Error("handoff-manifest.json must be a JSON object")
  }
  return raw as WorkflowManifest
}

export async function loadInput(inputPath: string): Promise<WorkflowInput> {
  const raw = JSON.parse(await readFile(inputPath, "utf8"))
  if (!isRecord(raw)) {
    throw new Error("input.json must be a JSON object")
  }
  return raw
}

export async function deriveRunDirectory(rootDirectory: string, workflowDirectory: string, explicitRunDirectory?: string): Promise<string> {
  if (explicitRunDirectory !== undefined) {
    return resolve(rootDirectory, explicitRunDirectory)
  }
  const manifest = await loadManifest(workflowDirectory)
  const rawInput = JSON.parse(await readFile(join(workflowDirectory, manifest.run.inputArtifact), "utf8"))
  if (!isRecord(rawInput)) {
    throw new Error("input.json must be a JSON object")
  }
  const slugFields = manifest.run.runSlugFromFields
  if (Array.isArray(slugFields) && slugFields.length > 0) {
    const slug = slugFields.map((field) => sanitizeRunId(readString(rawInput, field))).join("--")
    return resolve(rootDirectory, manifest.run.defaultRunDirectoryRoot, slug)
  }
  const runIdField = manifest.run.runIdField ?? "runId"
  return resolve(rootDirectory, manifest.run.defaultRunDirectoryRoot, sanitizeRunId(readString(rawInput, runIdField)))
}

export function verifyWorkflowContract(workflow: string): void {
  const requiredFragments = [
    "runtime:",
    "runner:",
    "transport: fake-session",
    "promptAssembly:",
    "manifest: handoff-manifest.json",
    "runDirectory:",
    "replay:",
    "inspectCommand:",
    "stageCommand:",
    "gateCommand:",
    "sessionsCommand:",
    "decision:",
    "jsonPath:",
    "outputs:",
    "clearOnEnter:",
    "resultArtifact:",
  ]
  for (const fragment of requiredFragments) {
    if (!workflow.includes(fragment)) {
      throw new Error(`Workflow prototype expected fragment: ${fragment}`)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty string at ${key}`)
  }
  return value
}

function sanitizeRunId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "run"
}
