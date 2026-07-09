import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"

import { executeSessionStage, listSessionRecords } from "./fake-session-server"
import { loadManifest, type WorkflowManifest, verifyWorkflowContract } from "./contracts"
import { appendJsonLine, clearPaths, readJsonObject, seedRunDirectory, writeJson } from "./persistence"
import { WorkflowMonitorStore } from "./workflow-monitor"

const DEBUG_GUIDE_FILENAME = "prototype-debug-commands.txt"

export async function runPrototypeWorkflow(input: {
  readonly freshRun: boolean
  readonly runDirectory: string
  readonly workflowPath: string
}): Promise<number> {
  const workflowText = await readFile(input.workflowPath, "utf8")
  verifyWorkflowContract(workflowText)
  const workflowDirectory = dirname(input.workflowPath)
  const manifest = await loadManifest(workflowDirectory)
  await seedRunDirectory({
    canonicalRunRoot: join(process.cwd(), manifest.run.defaultRunDirectoryRoot),
    freshRun: input.freshRun,
    freshRunMarker: manifest.run.freshRunMarker,
    runDirectory: input.runDirectory,
    seedArtifacts: manifest.run.seedArtifacts,
    workflowDirectory,
  })
  const debugGuidePath = await writeDebugGuide({
    manifest,
    runDirectory: input.runDirectory,
    workflowPath: input.workflowPath,
  })
  const commands = debugCommands({ manifest, runDirectory: input.runDirectory, workflowPath: input.workflowPath })
  const monitor = new WorkflowMonitorStore({
    debugSurface: {
      gateReplayTemplate: commands.gate("{{gate}}"),
      inspectCommand: commands.inspect,
      sessionsCommand: commands.sessions,
      stageReplayTemplate: commands.stage("{{stage}}"),
    },
    manifest,
    runDirectory: input.runDirectory,
    workflowPath: input.workflowPath,
  })
  await monitor.initialize()
  monitor.startHeartbeat()
  try {
    console.log(`[prototype-runner] inspect=${commands.inspect}`)
    console.log(`[prototype-runner] sessions=${commands.sessions}`)
    console.log(`[prototype-runner] debugGuide=${debugGuidePath}`)
    console.log(`[workflow-monitor] build=cd ${join(process.cwd(), "workflow-monitor")} && bun install && bun run build`)
    const monitorRunsRoot = dirname(join(process.cwd(), manifest.run.defaultRunDirectoryRoot))
    console.log(
      `[workflow-monitor] start=cd ${join(process.cwd(), "workflow-monitor")} && bun run start -- --runs-root ${monitorRunsRoot} --default-run ${input.runDirectory}`,
    )
    await writeState(input.runDirectory, { node: "plan", status: "running", workflow: manifest.run.workflowName })

    for (let reviewAttempt = 1; reviewAttempt <= 2; reviewAttempt += 1) {
      await executeStage({ manifest, monitor, runDirectory: input.runDirectory, stageId: reviewAttempt === 1 ? "plan" : "plan_feedback", workflowDirectory })
      await executeStage({ manifest, monitor, runDirectory: input.runDirectory, stageId: "codegen", workflowDirectory })
      const correctness = await runGateWithFeedback({ gateId: "correctness", feedbackStage: "codegen_feedback", manifest, monitor, runDirectory: input.runDirectory, workflowDirectory })
      if (!correctness.ok) {
        await writeState(input.runDirectory, { node: "correctness", status: "failed" })
        await monitor.workflowFailed({ detail: "correctness gate failed", nodeId: "correctness" })
        return correctness.exitCode
      }
      await executeStage({ manifest, monitor, runDirectory: input.runDirectory, stageId: "optimize", workflowDirectory })
      const perf = await runGateWithFeedback({ gateId: "perf", feedbackStage: "optimize_feedback", manifest, monitor, runDirectory: input.runDirectory, workflowDirectory })
      if (!perf.ok) {
        await writeState(input.runDirectory, { node: "perf", status: "failed" })
        await monitor.workflowFailed({ detail: "performance gate failed", nodeId: "perf" })
        return perf.exitCode
      }
      await executeStage({ manifest, monitor, runDirectory: input.runDirectory, stageId: "review", workflowDirectory })
      const reviewArtifactPath = join(input.runDirectory, manifest.decision.artifact)
      const approved = await readReviewApproval({ artifactPath: reviewArtifactPath, manifest })
      await monitor.reviewDecision({ approved, artifactPath: reviewArtifactPath })
      if (approved) {
        const finalize = await runGate({ gateId: "finalize", manifest, monitor, runDirectory: input.runDirectory, workflowDirectory })
        await writeState(input.runDirectory, { node: "finalize", status: finalize.ok ? "completed" : "failed" })
        if (finalize.ok) {
          await monitor.workflowCompleted({ detail: "workflow reached finalize", nodeId: "finalize", status: "completed" })
        } else {
          await monitor.workflowFailed({ detail: "finalize gate failed", nodeId: "finalize" })
        }
        return finalize.exitCode
      }
    }

    await writeState(input.runDirectory, { node: "plan_feedback", status: "failed" })
    await monitor.workflowFailed({ detail: "review remained unapproved after max attempts", nodeId: "plan_feedback" })
    return 1
  } finally {
    monitor.stopHeartbeat()
  }
}

export async function replayStage(input: {
  readonly runDirectory: string
  readonly stageId: string
  readonly workflowPath: string
}): Promise<void> {
  const workflowDirectory = dirname(input.workflowPath)
  const manifest = await loadManifest(workflowDirectory)
  const monitor = new WorkflowMonitorStore({
    debugSurface: replayDebugSurface({ manifest, runDirectory: input.runDirectory, workflowPath: input.workflowPath }),
    manifest,
    runDirectory: input.runDirectory,
    workflowPath: input.workflowPath,
  })
  await monitor.initialize()
  monitor.startHeartbeat()
  try {
    await executeStage({ manifest, monitor, runDirectory: input.runDirectory, stageId: input.stageId, workflowDirectory })
  } finally {
    monitor.stopHeartbeat()
  }
}

export async function replayGate(input: {
  readonly gateId: string
  readonly runDirectory: string
  readonly workflowPath: string
}): Promise<number> {
  const workflowDirectory = dirname(input.workflowPath)
  const manifest = await loadManifest(workflowDirectory)
  const monitor = new WorkflowMonitorStore({
    debugSurface: replayDebugSurface({ manifest, runDirectory: input.runDirectory, workflowPath: input.workflowPath }),
    manifest,
    runDirectory: input.runDirectory,
    workflowPath: input.workflowPath,
  })
  await monitor.initialize()
  monitor.startHeartbeat()
  try {
    return (await runGate({ gateId: input.gateId, manifest, monitor, runDirectory: input.runDirectory, workflowDirectory })).exitCode
  } finally {
    monitor.stopHeartbeat()
  }
}

export async function inspectRunDirectory(input: {
  readonly runDirectory: string
}): Promise<string> {
  const state = await readJsonObject<Record<string, unknown>>(join(input.runDirectory, "artifacts", "state.json"))
  const sessions = await listSessionRecords(input.runDirectory)
  const transcript = (await Bun.file(join(input.runDirectory, "artifacts", "session-transcript.md")).exists())
    ? await readFile(join(input.runDirectory, "artifacts", "session-transcript.md"), "utf8")
    : ""
  return [
    `runDirectory=${input.runDirectory}`,
    `state=${JSON.stringify(state)}`,
    `sessions=${JSON.stringify(sessions)}`,
    transcript.trim(),
  ].join("\n\n")
}

export async function inspectSessions(input: {
  readonly runDirectory: string
}): Promise<string> {
  const sessions = await listSessionRecords(input.runDirectory)
  return sessions
    .map((session) => `${session.stage}=${session.id} engine=${session.engine} agent=${session.agent} promptCount=${session.promptCount}`)
    .join("\n")
}

type GateResult = {
  readonly exitCode: number
  readonly ok: boolean
}

async function executeStage(input: {
  readonly manifest: WorkflowManifest
  readonly monitor: WorkflowMonitorStore
  readonly runDirectory: string
  readonly stageId: string
  readonly workflowDirectory: string
}): Promise<void> {
  const stage = input.manifest.stages[input.stageId]
  if (stage === undefined) {
    throw new Error(`Unknown stage: ${input.stageId}`)
  }
  await clearPaths(input.runDirectory, stage.clearOnEnter)
  await executeSessionStage({
    ...input,
    hooks: {
      onStageCompleted: async ({ sessionRecord }) => {
        await input.monitor.syncSessions({
          manifest: input.manifest,
          records: [sessionRecord, ...(await listSessionRecords(input.runDirectory)).filter((record) => record.stage !== sessionRecord.stage)],
        })
      },
      onStageStarting: async ({ attempt, sessionRecord }) => {
        await input.monitor.stageStarted({ attempt, sessionId: sessionRecord.id, stageId: input.stageId })
      },
    },
  })
  for (const requiredOutput of stage.requiredOutputs) {
    if (!(await Bun.file(join(input.runDirectory, requiredOutput)).exists())) {
      throw new Error(`Stage '${input.stageId}' did not produce required output: ${requiredOutput}`)
    }
  }
  await input.monitor.syncSessions({ manifest: input.manifest, records: await listSessionRecords(input.runDirectory) })
  await input.monitor.stageCompleted({ outputsReady: true, stageId: input.stageId })
  await writeState(input.runDirectory, { node: input.stageId, status: "completed" })
}

async function runGateWithFeedback(input: {
  readonly feedbackStage: string
  readonly gateId: string
  readonly manifest: WorkflowManifest
  readonly monitor: WorkflowMonitorStore
  readonly runDirectory: string
  readonly workflowDirectory: string
}): Promise<GateResult> {
  const gate = input.manifest.gates[input.gateId]
  const maxAttempts = gate.maxAttempts ?? 1
  let lastResult: GateResult = { exitCode: 1, ok: false }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await runGate(input)
    if (lastResult.ok) {
      return lastResult
    }
    if (attempt < maxAttempts) {
      await executeStage({ manifest: input.manifest, monitor: input.monitor, runDirectory: input.runDirectory, stageId: input.feedbackStage, workflowDirectory: input.workflowDirectory })
    }
  }
  return lastResult
}

async function runGate(input: {
  readonly gateId: string
  readonly manifest: WorkflowManifest
  readonly monitor: WorkflowMonitorStore
  readonly runDirectory: string
  readonly workflowDirectory: string
}): Promise<GateResult> {
  const gate = input.manifest.gates[input.gateId]
  if (gate === undefined) {
    throw new Error(`Unknown gate: ${input.gateId}`)
  }
  await input.monitor.gateStarted(input.gateId)
  const command = gate.command.map((value) => value === "{{runDirectory}}" ? input.runDirectory : value)
  const subprocess = Bun.spawn(command, {
    cwd: input.workflowDirectory,
    stderr: "pipe",
    stdout: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  await mkdir(join(input.runDirectory, "artifacts", "logs"), { recursive: true })
  await writeFile(join(input.runDirectory, "artifacts", "logs", `${input.gateId}.stdout.txt`), stdout)
  await writeFile(join(input.runDirectory, "artifacts", "logs", `${input.gateId}.stderr.txt`), stderr)
  await appendJsonLine(join(input.runDirectory, "artifacts", "events.jsonl"), {
    exitCode,
    gate: input.gateId,
    kind: "gate",
    ok: exitCode === 0,
  })
  await input.monitor.gateCompleted({
    exitCode,
    gateId: input.gateId,
    resultArtifact: gate.resultArtifact,
  })
  return { exitCode, ok: exitCode === 0 }
}

async function readReviewApproval(input: {
  readonly artifactPath: string
  readonly manifest: WorkflowManifest
}): Promise<boolean> {
  const payload = await readJsonObject<Record<string, unknown>>(input.artifactPath)
  let cursor: unknown = payload
  for (const segment of input.manifest.decision.jsonPath) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor) || !(segment in cursor)) {
      return false
    }
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor === input.manifest.decision.equals
}

async function writeState(runDirectory: string, state: Record<string, string>): Promise<void> {
  const statePath = join(runDirectory, "artifacts", "state.json")
  const previous = (await Bun.file(statePath).exists()) ? await readJsonObject<Record<string, string>>(statePath) : {}
  await writeJson(statePath, { ...previous, ...state })
}

async function writeDebugGuide(input: {
  readonly manifest: WorkflowManifest
  readonly runDirectory: string
  readonly workflowPath: string
}): Promise<string> {
  const commands = debugCommands(input)
  const guidePath = join(input.runDirectory, "artifacts", DEBUG_GUIDE_FILENAME)
  await mkdir(join(input.runDirectory, "artifacts"), { recursive: true })
  const lines = [
    "# Prototype debug guide",
    `workflowPath=${input.workflowPath}`,
    `runDirectory=${input.runDirectory}`,
    "",
    "# Inspect run state",
    commands.inspect,
    "",
    "# List persisted sessions",
    commands.sessions,
    "",
    "# Concrete stage replay commands",
    ...Object.keys(input.manifest.stages).sort().map((stageId) => commands.stage(stageId)),
    "",
    "# Concrete gate replay commands",
    ...Object.keys(input.manifest.gates).sort().map((gateId) => commands.gate(gateId)),
  ]
  const monitorDirectory = join(process.cwd(), "workflow-monitor")
  const monitorRunsRoot = dirname(join(process.cwd(), input.manifest.run.defaultRunDirectoryRoot))
  lines.push(
    "",
    "# Workflow monitor frontend",
    `cd ${monitorDirectory} && bun install && bun run build`,
    `cd ${monitorDirectory} && bun run start -- --runs-root ${monitorRunsRoot} --default-run ${input.runDirectory}`,
  )
  await writeFile(guidePath, `${lines.join("\n")}\n`)
  return guidePath
}

function debugCommands(input: {
  readonly manifest: WorkflowManifest
  readonly runDirectory: string
  readonly workflowPath: string
}): {
  readonly inspect: string
  readonly sessions: string
  readonly stage: (stageId: string) => string
  readonly gate: (gateId: string) => string
} {
  const relativeWorkflowPath = relative(process.cwd(), input.workflowPath) || input.workflowPath
  return {
    inspect: ["bun", "run", "prototype:replay", "--", "--workflow", relativeWorkflowPath, "--run-dir", input.runDirectory, "--mode", "inspect"].join(" "),
    sessions: ["bun", "run", "prototype:replay", "--", "--workflow", relativeWorkflowPath, "--run-dir", input.runDirectory, "--mode", "sessions"].join(" "),
    stage: (stageId) => ["bun", "run", "prototype:replay", "--", "--workflow", relativeWorkflowPath, "--run-dir", input.runDirectory, "--mode", "stage", "--stage", stageId].join(" "),
    gate: (gateId) => ["bun", "run", "prototype:replay", "--", "--workflow", relativeWorkflowPath, "--run-dir", input.runDirectory, "--mode", "gate", "--gate", gateId].join(" "),
  }
}

function replayDebugSurface(input: {
  readonly manifest: WorkflowManifest
  readonly runDirectory: string
  readonly workflowPath: string
}): {
  readonly gateReplayTemplate: string
  readonly inspectCommand: string
  readonly sessionsCommand: string
  readonly stageReplayTemplate: string
} {
  const commands = debugCommands(input)
  return {
    gateReplayTemplate: commands.gate("{{gate}}"),
    inspectCommand: commands.inspect,
    sessionsCommand: commands.sessions,
    stageReplayTemplate: commands.stage("{{stage}}"),
  }
}
