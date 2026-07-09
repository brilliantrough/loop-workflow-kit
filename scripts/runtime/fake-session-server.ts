import { copyFile, mkdir, readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { StageContract, WorkflowManifest } from "./contracts"
import { appendJsonLine, readJsonObject, writeJson } from "./persistence"
import { assemblePrompt } from "./prompt-assembler"

export type SessionRecord = {
  readonly agent: string
  readonly engine: string
  readonly id: string
  readonly promptCount: number
  readonly stage: string
}

export async function executeSessionStage(input: {
  readonly hooks?: {
    readonly onStageCompleted?: (payload: { readonly sessionRecord: SessionRecord; readonly stageId: string }) => Promise<void> | void
    readonly onStageStarting?: (payload: { readonly attempt: number; readonly sessionRecord: SessionRecord; readonly stageId: string }) => Promise<void> | void
  }
  readonly manifest: WorkflowManifest
  readonly runDirectory: string
  readonly stageId: string
  readonly workflowDirectory: string
}): Promise<SessionRecord> {
  const stage = readStage(input.manifest, input.stageId)
  const sessionRecord = await createOrResumeSession({
    agent: input.manifest.sessions[stage.session]?.agent ?? stage.session,
    engine: input.manifest.sessions[stage.session]?.engine ?? "fake",
    runDirectory: input.runDirectory,
    sessionName: stage.session,
  })
  await input.hooks?.onStageStarting?.({
    attempt: sessionRecord.promptCount + 1,
    sessionRecord,
    stageId: input.stageId,
  })
  const prompt = await assemblePrompt({
    runDirectory: input.runDirectory,
    stage: stage,
    stageId: input.stageId,
    workflowDirectory: input.workflowDirectory,
  })
  await synthesizePrototypeOutputs({
    promptText: prompt.text,
    runDirectory: input.runDirectory,
    stage: stage,
    workflowDirectory: input.workflowDirectory,
  })
  const updated: SessionRecord = {
    ...sessionRecord,
    promptCount: sessionRecord.promptCount + 1,
  }
  await writeJson(sessionPath(input.runDirectory, stage.session), updated)
  await appendJsonLine(join(input.runDirectory, "artifacts", "session-events.jsonl"), {
    kind: "session-turn",
    promptPath: prompt.promptPath,
    session: stage.session,
    stage: input.stageId,
    turn: updated.promptCount,
  })
  await input.hooks?.onStageCompleted?.({
    sessionRecord: updated,
    stageId: input.stageId,
  })
  return updated
}

export async function listSessionRecords(runDirectory: string): Promise<readonly SessionRecord[]> {
  const sessionsDirectory = join(runDirectory, "sessions")
  let entries
  try {
    entries = await readdir(sessionsDirectory, { withFileTypes: true })
  } catch {
    return []
  }
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => readJsonObject<SessionRecord>(join(sessionsDirectory, entry.name))),
  )
  return records.sort((left, right) => left.stage.localeCompare(right.stage))
}

async function createOrResumeSession(input: {
  readonly agent: string
  readonly engine: string
  readonly runDirectory: string
  readonly sessionName: string
}): Promise<SessionRecord> {
  const path = sessionPath(input.runDirectory, input.sessionName)
  if (await Bun.file(path).exists()) {
    return readJsonObject<SessionRecord>(path)
  }
  await mkdir(join(input.runDirectory, "sessions"), { recursive: true })
  const record: SessionRecord = {
    agent: input.agent,
    engine: input.engine,
    id: `fake-${input.sessionName}`,
    promptCount: 0,
    stage: input.sessionName,
  }
  await writeJson(path, record)
  return record
}

async function synthesizePrototypeOutputs(input: {
  readonly promptText: string
  readonly runDirectory: string
  readonly stage: StageContract
  readonly workflowDirectory: string
}): Promise<void> {
  const inputPayload = await readJsonObject<{ readonly runId?: string }>(join(input.runDirectory, "artifacts", "input.json"))
  for (const relativePath of input.stage.prototypeOutputs) {
    const sourcePath = join(input.workflowDirectory, relativePath)
    const targetPath = join(input.runDirectory, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
  }
  const transcriptPath = join(input.runDirectory, "artifacts", "session-transcript.md")
  const previous = (await Bun.file(transcriptPath).exists()) ? await readFile(transcriptPath, "utf8") : ""
  await Bun.write(transcriptPath, `${previous}## ${input.stage.session}

${input.promptText}

runId=${inputPayload.runId ?? "unknown"}
`)
}

function readStage(manifest: WorkflowManifest, stageId: string): StageContract {
  const stage = manifest.stages[stageId]
  if (stage === undefined) {
    throw new Error(`Unknown stage contract: ${stageId}`)
  }
  return stage
}

function sessionPath(runDirectory: string, sessionName: string): string {
  return join(runDirectory, "sessions", `${sessionName}.json`)
}
