import { resolve } from "node:path"

export type RunnerArgs = {
  readonly agentTimeoutMs: number
  readonly freshRun: boolean
  readonly noStartOpencode: boolean
  readonly opencodeHost: string
  readonly opencodePort: number
  readonly opencodeUrl: string
  readonly runDirectory?: string
  readonly stopAfterSeed: boolean
  readonly workflowPath: string
}

export type ReplayArgs = RunnerArgs & {
  readonly gate?: string
  readonly mode: "gate" | "inspect" | "sessions" | "stage"
  readonly runDirectory: string
  readonly stage?: string
}

export function parseRunnerArgs(argv: readonly string[], defaults: { readonly opencodeUrl: string; readonly workflowPath: string }): RunnerArgs {
  return {
    agentTimeoutMs: Number(readOption(argv, "--agent-timeout-sec", "120")) * 1000,
    freshRun: argv.includes("--fresh-run"),
    noStartOpencode: argv.includes("--no-start-opencode"),
    opencodeHost: readOption(argv, "--opencode-host", "127.0.0.1"),
    opencodePort: Number(readOption(argv, "--opencode-port", "5096")),
    opencodeUrl: readOption(argv, "--opencode-url", defaults.opencodeUrl),
    runDirectory: readOptionalOption(argv, "--run-dir"),
    stopAfterSeed: argv.includes("--stop-after-seed"),
    workflowPath: resolve(readOption(argv, "--workflow", defaults.workflowPath)),
  }
}

export function parseReplayArgs(argv: readonly string[], defaults: { readonly opencodeUrl: string; readonly workflowPath: string }): ReplayArgs {
  const runDirectory = readOptionalOption(argv, "--run-dir")
  if (runDirectory === undefined) {
    throw new Error("--run-dir is required")
  }
  const mode = readOption(argv, "--mode", "inspect")
  if (!["gate", "inspect", "sessions", "stage"].includes(mode)) {
    throw new Error("--mode must be one of inspect, sessions, stage, gate")
  }
  const stage = readOptionalOption(argv, "--stage")
  const gate = readOptionalOption(argv, "--gate")
  if (mode === "stage" && stage === undefined) {
    throw new Error("--stage is required when --mode stage")
  }
  if (mode === "gate" && gate === undefined) {
    throw new Error("--gate is required when --mode gate")
  }
  return {
    ...parseRunnerArgs(argv, defaults),
    gate,
    mode: mode as ReplayArgs["mode"],
    runDirectory: resolve(runDirectory),
    stage,
  }
}

function readOption(argv: readonly string[], name: string, fallback: string): string {
  return readOptionalOption(argv, name) ?? fallback
}

function readOptionalOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) {
    return undefined
  }
  return argv[index + 1]
}
