import { join } from "node:path"

import { appendJsonLine, readJsonObject, writeJson } from "./json-store"

export type SessionRecord = {
  readonly agent: string
  readonly promptCount: number
  readonly sessionId: string
  readonly stage: string
}

type StorePayload = {
  runtimeState?: Record<string, unknown>
  sessions?: Record<string, { agent: string; id: string; promptCount: number }>
}

export class SessionStore {
  private readonly path: string
  private readonly turnsPath: string

  constructor(runDirectory: string) {
    this.path = join(runDirectory, "artifacts", "opencode-sessions.json")
    this.turnsPath = join(runDirectory, "artifacts", "opencode-turns.jsonl")
  }

  async get(stage: string): Promise<SessionRecord | undefined> {
    const payload = await this.load()
    const raw = payload.sessions?.[stage]
    if (raw === undefined) {
      return undefined
    }
    return { agent: raw.agent, promptCount: raw.promptCount, sessionId: raw.id, stage }
  }

  async upsert(stage: string, input: { readonly agent: string; readonly promptCount: number; readonly sessionId: string }): Promise<SessionRecord> {
    const payload = await this.load()
    payload.sessions ??= {}
    payload.sessions[stage] = { agent: input.agent, id: input.sessionId, promptCount: input.promptCount }
    await this.write(payload)
    return { agent: input.agent, promptCount: input.promptCount, sessionId: input.sessionId, stage }
  }

  async appendTurn(value: Record<string, unknown>): Promise<void> {
    await appendJsonLine(this.turnsPath, value)
  }

  async setRuntimeState(state: Record<string, unknown>): Promise<void> {
    const payload = await this.load()
    payload.runtimeState = state
    await this.write(payload)
  }

  async sessions(): Promise<Record<string, { agent: string; id: string; promptCount: number }>> {
    return (await this.load()).sessions ?? {}
  }

  private async load(): Promise<StorePayload> {
    if (!(await Bun.file(this.path).exists())) {
      return {}
    }
    return (await readJsonObject(this.path)) as StorePayload
  }

  private async write(payload: StorePayload): Promise<void> {
    await writeJson(this.path, payload)
  }
}
