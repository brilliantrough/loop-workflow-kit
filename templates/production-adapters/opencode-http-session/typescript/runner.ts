import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import type { GateContract, WorkflowBundle } from "./contracts"
import { loadBundleContract } from "./contracts"
import { appendJsonLine, readJsonObject } from "./json-store"
import { OpencodeHttpClient, type OpencodeHttpConfig, OpencodeHttpError } from "./opencode-http"
import { ensureServer, stopServer, writeServerState } from "./opencode-server"
import { clearStageOutputs, ensureStageOutputs, renderPrompt, requiredOutputPaths } from "./prompt-assembly"
import { parseRunnerArgs } from "./runner-cli"
import { prepareRunDirectory, resolveRunDirectory } from "./runner-inputs"
import { type SessionRecord, SessionStore } from "./session-store"

export const WORKFLOW_ROOT = import.meta.dir
export const REPO_ROOT = resolve(WORKFLOW_ROOT, "..", "..")
export const DEFAULT_WORKFLOW = join(WORKFLOW_ROOT, "workflow.yml")
export const DEFAULT_OPENCODE_URL = "http://127.0.0.1:5096"

const MAX_REVIEW_ATTEMPTS = 2
const STAGE_POLL_INTERVAL_MS = 250
const STAGE_HARD_TIMEOUT_MULTIPLIER = 4
const OPEN_ASSISTANT_MAX_WAIT_MS = 3_600_000
const ATTACH_GUIDE_FILENAME = "opencode-attach-commands.txt"

export async function main(): Promise<number> {
  const parsed = parseRunnerArgs(Bun.argv.slice(2), { opencodeUrl: DEFAULT_OPENCODE_URL, workflowPath: DEFAULT_WORKFLOW })
  const bundle = await loadBundleContract(parsed.workflowPath)
  const runRoot = resolve(REPO_ROOT, bundle.runtime.runDirectory.root)
  const runDirectory = await resolveRunDirectory({
    deriveFromInput: bundle.runtime.runDirectory.deriveFromInput,
    explicitRunDirectory: parsed.runDirectory,
    inputArtifact: bundle.manifest.run.inputArtifact,
    repoRoot: REPO_ROOT,
    runRoot,
    workflowRoot: bundle.workflowRoot,
  })
  await prepareRunDirectory({
    freshRun: parsed.freshRun,
    markerName: bundle.runtime.runDirectory.freshRunMarker,
    runDirectory,
    runRoot,
    seedArtifacts: bundle.manifest.run.seedArtifacts,
    workflowRoot: bundle.workflowRoot,
  })
  if (parsed.stopAfterSeed) {
    return 0
  }
  const store = new SessionStore(runDirectory)
  const httpConfig: OpencodeHttpConfig = {
    baseUrl: parsed.opencodeUrl,
    password: process.env.OPENCODE_SERVER_PASSWORD,
    timeoutMs: parsed.agentTimeoutMs,
    username: process.env.OPENCODE_SERVER_USERNAME,
  }
  const server = await ensureServer({
    baseUrl: parsed.opencodeUrl,
    host: parsed.opencodeHost,
    noStart: parsed.noStartOpencode,
    password: httpConfig.password,
    port: parsed.opencodePort,
    runDirectory,
    timeoutMs: parsed.agentTimeoutMs,
    username: httpConfig.username,
    workdir: REPO_ROOT,
  })
  await writeServerState(join(runDirectory, "artifacts", "opencode-server.json"), server)
  const client = new OpencodeHttpClient({ ...httpConfig, baseUrl: server.baseUrl })
  await ensureWorkflowSessions({ bundle, client, runDirectory, store })
  await printObserverSummary({ bundle, runDirectory, serverUrl: server.baseUrl, store })
  try {
    return await runWorkflow({ agentTimeoutMs: parsed.agentTimeoutMs, bundle, client, runDirectory, serverUrl: server.baseUrl, store })
  } finally {
    stopServer(server)
  }
}

export async function runWorkflow(input: {
  readonly agentTimeoutMs: number
  readonly bundle: WorkflowBundle
  readonly client: OpencodeHttpClient
  readonly runDirectory: string
  readonly serverUrl: string
  readonly store: SessionStore
}): Promise<number> {
  let current = input.bundle.entry
  let reviewAttempts = 0
  for (let transition = 0; transition < 256; transition += 1) {
    const stage = input.bundle.manifest.stages[current]
    if (stage !== undefined) {
      await runStage({ ...input, stage: current })
      let nextNode = stage.routing.onSuccess
      if (await stageControlsDecision(input.runDirectory, current, input.bundle)) {
        const approved = await decisionMatchesContract(input.runDirectory, input.bundle)
        nextNode = approved ? stage.routing.onSuccess : stage.routing.onFailure
        if (!approved) {
          reviewAttempts += 1
          if (reviewAttempts > MAX_REVIEW_ATTEMPTS) {
            await input.store.setRuntimeState({ reason: "review decision remained unapproved after max attempts", stage: current, status: "failed" })
            return 1
          }
        }
      }
      if (nextNode === undefined) {
        await input.store.setRuntimeState({ stage: current, status: "completed" })
        return 0
      }
      current = nextNode
      continue
    }
    const gate = input.bundle.manifest.gates[current]
    if (gate !== undefined) {
      if (current === "finalize") {
        const result = await runGate({ bundle: input.bundle, gate: current, runDirectory: input.runDirectory })
        await input.store.setRuntimeState({ stage: current, status: result.ok ? "completed" : "failed" })
        return result.exitCode
      }
      const result = await retryGateWithFeedback({ ...input, gate: current })
      if (result.ok) {
        current = gate.pass ?? ""
        if (current.length === 0) {
          await input.store.setRuntimeState({ stage: result.label, status: "completed" })
          return result.exitCode
        }
        continue
      }
      if ((gate.maxAttempts ?? 1) > 1 && gate.fail?.endsWith("_feedback")) {
        await input.store.setRuntimeState({ stage: result.label, status: "failed" })
        return result.exitCode
      }
      current = gate.fail ?? ""
      if (current.length === 0) {
        await input.store.setRuntimeState({ stage: result.label, status: "failed" })
        return result.exitCode
      }
      continue
    }
    throw new Error(`workflow routed to unknown node: ${current}`)
  }
  await input.store.setRuntimeState({ reason: "workflow exceeded 256 node transitions", stage: current, status: "failed" })
  return 1
}

export async function retryGateWithFeedback(input: {
  readonly agentTimeoutMs: number
  readonly bundle: WorkflowBundle
  readonly client: OpencodeHttpClient
  readonly gate: string
  readonly runDirectory: string
  readonly serverUrl: string
  readonly store: SessionStore
}): Promise<{ readonly exitCode: number; readonly label: string; readonly ok: boolean }> {
  const gate = input.bundle.manifest.gates[input.gate]
  let last = { exitCode: 1, label: input.gate, ok: false }
  for (let attempt = 1; attempt <= (gate.maxAttempts ?? 1); attempt += 1) {
    last = await runGate({ bundle: input.bundle, gate: input.gate, runDirectory: input.runDirectory })
    if (last.ok) {
      return last
    }
    if (attempt < (gate.maxAttempts ?? 1) && gate.fail !== undefined && input.bundle.manifest.stages[gate.fail] !== undefined) {
      await runStage({ ...input, stage: gate.fail })
    }
  }
  return last
}

export async function runStage(input: {
  readonly agentTimeoutMs: number
  readonly bundle: WorkflowBundle
  readonly client: OpencodeHttpClient
  readonly runDirectory: string
  readonly serverUrl: string
  readonly stage: string
  readonly store: SessionStore
}): Promise<void> {
  const stageContract = input.bundle.manifest.stages[input.stage]
  if (stageContract === undefined) {
    throw new Error(`unknown stage: ${input.stage}`)
  }
  const session = await getOrCreateSession({ bundle: input.bundle, client: input.client, stage: stageContract.session, store: input.store })
  const attempt = session.promptCount + 1
  await clearStageOutputs({ bundle: input.bundle, repoRoot: REPO_ROOT, runDirectory: input.runDirectory, stage: input.stage })
  const rendered = await renderPrompt({ attempt, bundle: input.bundle, repoRoot: REPO_ROOT, runDirectory: input.runDirectory, stage: input.stage })
  await logRunnerEvent(input.runDirectory, input.stage, `submitting prompt ${rendered.promptPath}`)
  await input.client.sendPromptAsync(session.sessionId, { agent: session.agent, prompt: rendered.text })
  await input.store.upsert(stageContract.session, { agent: session.agent, promptCount: attempt, sessionId: session.sessionId })
  await input.store.appendTurn({ agent: session.agent, attempt, kind: "stage-prompt", promptPath: rendered.promptPath, session: stageContract.session, sessionId: session.sessionId, stage: input.stage })
  await waitForStageCompletion({ agentTimeoutMs: input.agentTimeoutMs, bundle: input.bundle, client: input.client, runDirectory: input.runDirectory, sessionId: session.sessionId, stage: input.stage })
  await ensureStageOutputs({ bundle: input.bundle, repoRoot: REPO_ROOT, runDirectory: input.runDirectory, stage: input.stage })
  await input.store.setRuntimeState({ serverUrl: input.serverUrl, stage: input.stage, status: "completed" })
}

export async function runGate(input: {
  readonly bundle: WorkflowBundle
  readonly gate: string
  readonly runDirectory: string
}): Promise<{ readonly exitCode: number; readonly label: string; readonly ok: boolean }> {
  const gate = input.bundle.manifest.gates[input.gate]
  if (gate === undefined) {
    throw new Error(`unknown gate: ${input.gate}`)
  }
  const command = renderCommand(gate, input.runDirectory)
  const subprocess = Bun.spawn(command, {
    cwd: gateCwd(input.bundle, input.gate),
    stderr: "pipe",
    stdout: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  await mkdir(join(input.runDirectory, "artifacts", "logs"), { recursive: true })
  await writeFile(join(input.runDirectory, "artifacts", "logs", `${input.gate}.stdout.txt`), stdout)
  await writeFile(join(input.runDirectory, "artifacts", "logs", `${input.gate}.stderr.txt`), stderr)
  await appendJsonLine(join(input.runDirectory, "artifacts", "events.jsonl"), { exitCode, gate: input.gate, kind: "gate", ok: exitCode === 0 })
  return { exitCode, label: input.gate, ok: exitCode === 0 }
}

export async function getOrCreateSession(input: {
  readonly bundle: WorkflowBundle
  readonly client: OpencodeHttpClient
  readonly stage: string
  readonly store: SessionStore
}): Promise<SessionRecord> {
  const sessionContract = input.bundle.manifest.sessions[input.stage]
  if (sessionContract === undefined) {
    throw new Error(`session contract missing for ${input.stage}`)
  }
  const existing = await input.store.get(input.stage)
  if (existing !== undefined && (await input.client.getSession(existing.sessionId)) !== undefined) {
    return existing
  }
  const created = await input.client.createSession(`${input.bundle.manifest.run.workflowName}:${input.stage}`)
  return input.store.upsert(input.stage, { agent: sessionContract.agent, promptCount: 0, sessionId: created.sessionId })
}

export async function ensureWorkflowSessions(input: {
  readonly bundle: WorkflowBundle
  readonly client: OpencodeHttpClient
  readonly runDirectory: string
  readonly store: SessionStore
}): Promise<void> {
  for (const stage of Object.keys(input.bundle.manifest.sessions).sort()) {
    await getOrCreateSession({ bundle: input.bundle, client: input.client, stage, store: input.store })
  }
  await refreshAttachGuide({ ...input, serverUrl: "<pending>" })
}

export async function waitForStageCompletion(input: {
  readonly agentTimeoutMs: number
  readonly bundle: WorkflowBundle
  readonly client: OpencodeHttpClient
  readonly runDirectory: string
  readonly sessionId: string
  readonly stage: string
}): Promise<void> {
  const deadline = Date.now() + Math.max(input.agentTimeoutMs * STAGE_HARD_TIMEOUT_MULTIPLIER, OPEN_ASSISTANT_MAX_WAIT_MS)
  while (Date.now() < deadline) {
    const observation = await observeStageCompletion(input)
    await appendJsonLine(join(input.runDirectory, "artifacts", "events.jsonl"), { kind: "stage-observe", stage: input.stage, ...observation, outputFingerprint: undefined })
    if (observation.assistantCompleted && observation.outputsComplete) {
      return
    }
    await Bun.sleep(STAGE_POLL_INTERVAL_MS)
  }
  throw new Error(`stage ${input.stage} did not complete before timeout`)
}

export async function observeStageCompletion(input: {
  readonly bundle: WorkflowBundle
  readonly client: OpencodeHttpClient
  readonly runDirectory: string
  readonly sessionId: string
  readonly stage: string
}): Promise<{
  readonly assistantCompleted: boolean
  readonly assistantStarted: boolean
  readonly messagesSupported: boolean
  readonly missingOutputs: readonly string[]
  readonly openAssistant: boolean
  readonly outputFingerprint: readonly [string, boolean, number | undefined][]
  readonly outputsComplete: boolean
}> {
  let messagesSupported = true
  let assistantStarted = false
  let assistantCompleted = false
  try {
    const messages = await input.client.listMessages(input.sessionId)
    const assistantMessages = messages.filter((message) => message.role === "assistant")
    assistantStarted = assistantMessages.length > 0
    assistantCompleted = assistantMessages.some(messageLooksComplete)
  } catch (error) {
    if (!(error instanceof OpencodeHttpError)) {
      throw error
    }
    messagesSupported = false
    assistantCompleted = true
  }
  const outputFingerprint: [string, boolean, number | undefined][] = []
  const missingOutputs: string[] = []
  for (const path of requiredOutputPaths({ bundle: input.bundle, repoRoot: REPO_ROOT, runDirectory: input.runDirectory, stage: input.stage })) {
    const file = Bun.file(path)
    const exists = await file.exists()
    outputFingerprint.push([path, exists, exists ? file.size : undefined])
    if (!exists) {
      missingOutputs.push(path)
    }
  }
  return {
    assistantCompleted,
    assistantStarted,
    messagesSupported,
    missingOutputs,
    openAssistant: assistantStarted && !assistantCompleted,
    outputFingerprint,
    outputsComplete: missingOutputs.length === 0,
  }
}

export async function printObserverSummary(input: {
  readonly bundle: WorkflowBundle
  readonly runDirectory: string
  readonly serverUrl: string
  readonly store: SessionStore
}): Promise<void> {
  await refreshAttachGuide(input)
  const guidePath = join(input.runDirectory, "artifacts", ATTACH_GUIDE_FILENAME)
  console.log(`[runner] runDirectory=${input.runDirectory}`)
  console.log(`[runner] opencodeServer=${input.serverUrl}`)
  console.log(`[runner] attachGuide=${guidePath}`)
  console.log("[runner] attach commands:")
  console.log(await readFile(guidePath, "utf8"))
}

export async function refreshAttachGuide(input: {
  readonly bundle: WorkflowBundle
  readonly runDirectory: string
  readonly serverUrl: string
  readonly store: SessionStore
}): Promise<void> {
  const lines = [
    "# OpenCode attach commands",
    `server=${input.serverUrl}`,
    `runDirectory=${input.runDirectory}`,
    "",
    "# Use /exit to leave the TUI client. It should not cancel server-owned execution.",
  ]
  const sessions = await input.store.sessions()
  for (const stage of Object.keys(input.bundle.manifest.sessions).sort()) {
    const record = sessions[stage]
    if (record === undefined) {
      continue
    }
    lines.push("", `# ${stage}`, attachCommand(input.serverUrl, record.id))
  }
  await writeFile(join(input.runDirectory, "artifacts", ATTACH_GUIDE_FILENAME), `${lines.join("\n")}\n`)
}

export function attachCommand(serverUrl: string, sessionId: string): string {
  return ["opencode", "attach", shellQuote(serverUrl), "--dir", shellQuote(REPO_ROOT), "--session", shellQuote(sessionId)].join(" ")
}

function renderCommand(gate: GateContract, runDirectory: string): string[] {
  return gate.command.map((part) => part.replaceAll("{{runDirectory}}", runDirectory))
}

function gateCwd(bundle: WorkflowBundle, gate: string): string {
  const cwd = bundle.gateCwds[gate]
  return cwd === undefined ? bundle.workflowRoot : resolve(bundle.workflowRoot, cwd)
}

async function stageControlsDecision(runDirectory: string, stage: string, bundle: WorkflowBundle): Promise<boolean> {
  if (stage === "review") {
    return true
  }
  const stageContract = bundle.manifest.stages[stage]
  return stageContract.requiredOutputs.includes(bundle.manifest.decision.artifact) && (await Bun.file(join(runDirectory, bundle.manifest.decision.artifact)).exists())
}

async function decisionMatchesContract(runDirectory: string, bundle: WorkflowBundle): Promise<boolean> {
  const path = join(runDirectory, bundle.manifest.decision.artifact)
  if (!(await Bun.file(path).exists())) {
    return false
  }
  let cursor: unknown = await readJsonObject(path)
  for (const segment of bundle.manifest.decision.jsonPath) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor) || !(segment in cursor)) {
      return false
    }
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor === bundle.manifest.decision.equals
}

async function logRunnerEvent(runDirectory: string, label: string, message: string): Promise<void> {
  await appendJsonLine(join(runDirectory, "artifacts", "runner-events.jsonl"), { label, message, time: Date.now() / 1000 })
}

function messageLooksComplete(message: Record<string, unknown>): boolean {
  const status = message.status
  if (typeof status === "string" && ["completed", "done", "idle"].includes(status.toLowerCase())) {
    return true
  }
  if (Array.isArray(message.parts) || typeof message.content === "string") {
    return true
  }
  return false
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

if (import.meta.main) {
  process.exit(await main())
}
