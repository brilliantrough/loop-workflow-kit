import { join } from "node:path"

import { loadBundleContract } from "./contracts"
import { readJsonObject } from "./json-store"
import { OpencodeHttpClient } from "./opencode-http"
import { ensureServer, stopServer, writeServerState } from "./opencode-server"
import { DEFAULT_OPENCODE_URL, DEFAULT_WORKFLOW, REPO_ROOT, runGate, runStage } from "./runner"
import { parseReplayArgs } from "./runner-cli"
import { SessionStore } from "./session-store"

async function main(): Promise<number> {
  const args = parseReplayArgs(Bun.argv.slice(2), { opencodeUrl: DEFAULT_OPENCODE_URL, workflowPath: DEFAULT_WORKFLOW })
  const bundle = await loadBundleContract(args.workflowPath)
  if (args.mode === "inspect") {
    console.log(await inspectRunDirectory(args.runDirectory))
    return 0
  }
  if (args.mode === "sessions") {
    console.log(await printActiveSessionIds(args.runDirectory))
    return 0
  }
  if (args.mode === "gate") {
    return (await runGate({ bundle, gate: args.gate ?? "", runDirectory: args.runDirectory })).exitCode
  }
  const store = new SessionStore(args.runDirectory)
  const server = await ensureServer({
    baseUrl: args.opencodeUrl,
    host: args.opencodeHost,
    noStart: args.noStartOpencode,
    password: process.env.OPENCODE_SERVER_PASSWORD,
    port: args.opencodePort,
    runDirectory: args.runDirectory,
    timeoutMs: args.agentTimeoutMs,
    username: process.env.OPENCODE_SERVER_USERNAME,
    workdir: REPO_ROOT,
  })
  await writeServerState(join(args.runDirectory, "artifacts", "opencode-server.json"), server)
  const client = new OpencodeHttpClient({
    baseUrl: server.baseUrl,
    password: process.env.OPENCODE_SERVER_PASSWORD,
    timeoutMs: args.agentTimeoutMs,
    username: process.env.OPENCODE_SERVER_USERNAME,
  })
  try {
    await runStage({
      agentTimeoutMs: args.agentTimeoutMs,
      bundle,
      client,
      runDirectory: args.runDirectory,
      serverUrl: server.baseUrl,
      stage: args.stage ?? "",
      store,
    })
    return 0
  } finally {
    stopServer(server)
  }
}

async function inspectRunDirectory(runDirectory: string): Promise<string> {
  const sessionPath = join(runDirectory, "artifacts", "opencode-sessions.json")
  const payload = (await Bun.file(sessionPath).exists()) ? await readJsonObject(sessionPath) : {}
  return [
    `runDirectory=${runDirectory}`,
    `inputArtifact=${join(runDirectory, "artifacts", "input.json")}`,
    `attachGuide=${join(runDirectory, "artifacts", "opencode-attach-commands.txt")}`,
    `runtimeState=${JSON.stringify(payload.runtimeState ?? {})}`,
    `sessions=${JSON.stringify(payload.sessions ?? {})}`,
  ].join("\n")
}

async function printActiveSessionIds(runDirectory: string): Promise<string> {
  const sessionPath = join(runDirectory, "artifacts", "opencode-sessions.json")
  if (!(await Bun.file(sessionPath).exists())) {
    return ""
  }
  const payload = await readJsonObject(sessionPath)
  const sessions = payload.sessions
  if (typeof sessions !== "object" || sessions === null || Array.isArray(sessions)) {
    return ""
  }
  return Object.entries(sessions as Record<string, Record<string, unknown>>)
    .filter(([, item]) => typeof item.id === "string")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stage, item]) => `${stage}=${item.id}`)
    .join("\n")
}

if (import.meta.main) {
  process.exit(await main())
}
