import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

import { writeJson } from "./json-store"
import { OpencodeHttpClient, OpencodeHttpError } from "./opencode-http"

export type OpencodeServerState = {
  readonly baseUrl: string
  readonly host: string
  readonly logPath: string
  readonly ownedByRunner: boolean
  readonly port: number
  readonly processPid?: number
  readonly version?: string
}

const SERVER_READY_DEADLINE_MS = 20_000
const SERVER_POLL_INTERVAL_MS = 250

export async function ensureServer(input: {
  readonly baseUrl: string
  readonly host: string
  readonly noStart: boolean
  readonly password?: string
  readonly port: number
  readonly runDirectory: string
  readonly timeoutMs: number
  readonly username?: string
  readonly workdir: string
}): Promise<OpencodeServerState> {
  const client = new OpencodeHttpClient({
    baseUrl: input.baseUrl,
    password: input.password,
    timeoutMs: input.timeoutMs,
    username: input.username,
  })
  const existing = await tryHealth(client)
  const logPath = join(input.runDirectory, "artifacts", "opencode-server.log")
  if (existing !== undefined) {
    return { baseUrl: input.baseUrl, host: input.host, logPath, ownedByRunner: false, port: input.port, version: healthVersion(existing) }
  }
  if (input.noStart) {
    throw new Error(`OpenCode server is not reachable at ${input.baseUrl}`)
  }
  await mkdir(dirname(logPath), { recursive: true })
  const logFile = Bun.file(logPath)
  const process = Bun.spawn(["opencode", "serve", "--hostname", input.host, "--port", String(input.port), "--print-logs"], {
    cwd: input.workdir,
    stderr: logFile,
    stdout: logFile,
  })
  const deadline = Date.now() + SERVER_READY_DEADLINE_MS
  while (Date.now() < deadline) {
    const health = await tryHealth(client)
    if (health !== undefined) {
      return {
        baseUrl: input.baseUrl,
        host: input.host,
        logPath,
        ownedByRunner: true,
        port: input.port,
        processPid: process.pid,
        version: healthVersion(health),
      }
    }
    if (process.exitCode !== null) {
      break
    }
    await Bun.sleep(SERVER_POLL_INTERVAL_MS)
  }
  process.kill()
  throw new Error(`failed to start OpenCode server at ${input.baseUrl}; see ${logPath}`)
}

export function stopServer(state: OpencodeServerState): void {
  if (state.ownedByRunner && state.processPid !== undefined) {
    try {
      process.kill(state.processPid)
    } catch {
      // The server may have exited on its own.
    }
  }
}

export async function writeServerState(path: string, state: OpencodeServerState): Promise<void> {
  await writeJson(path, state)
}

async function tryHealth(client: OpencodeHttpClient): Promise<Record<string, unknown> | undefined> {
  try {
    return await client.health()
  } catch (error) {
    if (error instanceof OpencodeHttpError || error instanceof TypeError) {
      return undefined
    }
    throw error
  }
}

function healthVersion(payload: Record<string, unknown>): string | undefined {
  return typeof payload.version === "string" ? payload.version : undefined
}
