import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

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
  readonly requiredOutputs: readonly string[]
  readonly routing: {
    readonly onFailure?: string
    readonly onSuccess?: string
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
    readonly approvalSignal?: string
    readonly artifact: string
    readonly equals: unknown
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

export type WorkflowRuntime = {
  readonly decision: WorkflowManifest["decision"]
  readonly promptAssembly: {
    readonly deterministic: boolean
    readonly manifest: string
  }
  readonly replay: {
    readonly gateCommand: string
    readonly inspectCommand: string
    readonly sessionsCommand?: string
    readonly stageCommand: string
  }
  readonly runDirectory: {
    readonly deriveFromInput: string
    readonly freshRunMarker: string
    readonly resumePolicy: string
    readonly root: string
  }
  readonly runner: {
    readonly adapter?: string
    readonly command: string
    readonly transport: string
  }
}

export type WorkflowBundle = {
  readonly entry: string
  readonly gateCwds: Record<string, string | undefined>
  readonly manifest: WorkflowManifest
  readonly manifestPath: string
  readonly runtime: WorkflowRuntime
  readonly workflowPath: string
  readonly workflowRoot: string
}

export async function loadBundleContract(workflowPath: string): Promise<WorkflowBundle> {
  const workflowText = await readFile(workflowPath, "utf8")
  const workflow = Bun.YAML.parse(workflowText) as unknown
  if (!isRecord(workflow)) {
    throw new Error(`workflow.yml must be an object: ${workflowPath}`)
  }
  const runtime = readRecord(workflow, "runtime") as WorkflowRuntime
  if (runtime.runner.transport !== "opencode-http-session") {
    throw new Error("production template expects runtime.runner.transport=opencode-http-session")
  }
  if (runtime.promptAssembly.manifest !== "handoff-manifest.json") {
    throw new Error("production template expects promptAssembly.manifest=handoff-manifest.json")
  }
  const workflowRoot = dirname(resolve(workflowPath))
  const manifestPath = resolve(workflowRoot, runtime.promptAssembly.manifest)
  const manifest = await loadManifest(manifestPath)
  const nodes = readRecord(workflow, "nodes")
  const gateCwds: Record<string, string | undefined> = {}
  for (const gate of Object.keys(manifest.gates)) {
    const node = readRecord(nodes, gate)
    gateCwds[gate] = typeof node.cwd === "string" ? node.cwd : undefined
  }
  return {
    entry: readString(workflow, "entry"),
    gateCwds,
    manifest,
    manifestPath,
    runtime,
    workflowPath: resolve(workflowPath),
    workflowRoot,
  }
}

export async function loadManifest(manifestPath: string): Promise<WorkflowManifest> {
  const payload = JSON.parse(await readFile(manifestPath, "utf8")) as unknown
  if (!isRecord(payload)) {
    throw new Error(`handoff-manifest.json must be an object: ${manifestPath}`)
  }
  return payload as WorkflowManifest
}

export async function readRunInput(bundle: WorkflowBundle, runDirectory: string): Promise<Record<string, unknown>> {
  const raw = JSON.parse(await readFile(join(runDirectory, bundle.manifest.run.inputArtifact), "utf8")) as unknown
  if (!isRecord(raw)) {
    throw new Error("workflow input artifact must be a JSON object")
  }
  return raw
}

function readRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key]
  if (!isRecord(value)) {
    throw new Error(`expected object at ${key}`)
  }
  return value
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`expected non-empty string at ${key}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
