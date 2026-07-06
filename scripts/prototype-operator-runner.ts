import { copyFile, mkdir, readFile, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

type CliArgs = {
  readonly runDirectory: string
  readonly workflowPath: string
}

type CommandResult = {
  readonly exitCode: number
  readonly ok: boolean
}

const CONTINUE_MESSAGE = "检验不通过的，请继续修改代码。"

const args = parseArgs(process.argv.slice(2))
const rootDirectory = process.cwd()
const workflowPath = resolve(rootDirectory, args.workflowPath)
const workflowDirectory = dirname(workflowPath)
const runDirectory = resolve(rootDirectory, args.runDirectory)

const workflowText = await readFile(workflowPath, "utf8")
verifyWorkflowContract(workflowText)
await seedRunDirectory({ runDirectory, workflowDirectory })

console.log(`[prototype-runner] workflow=${workflowPath}`)
console.log(`[prototype-runner] runDirectory=${runDirectory}`)
console.log("[prototype-runner] placeholder mode: agent nodes are logged, command/gate nodes are executed")

logAgentNode({
  prompt: "prompts/operator-plan.md",
  session: "plan",
  stage: "plan",
})

logAgentNode({
  prompt: "prompts/operator-codegen.md",
  session: "codegen",
  stage: "codegen",
})

await runGateWithFeedback({
  artifact: "artifacts/correctness.json",
  command: ["bun", "run", join(workflowDirectory, "checks/fake-correctness.ts"), "--run-dir", runDirectory],
  gate: "correctness",
  maxAttempts: 2,
  session: "codegen",
})

logAgentNode({
  prompt: "prompts/operator-optimize.md",
  session: "optimize",
  stage: "optimize",
})

await runGateWithFeedback({
  artifact: "artifacts/perf.json",
  command: ["bun", "run", join(workflowDirectory, "checks/fake-perf.ts"), "--run-dir", runDirectory],
  gate: "perf",
  maxAttempts: 2,
  session: "optimize",
})

logAgentNode({
  prompt: "prompts/operator-review.md",
  session: "review",
  stage: "review",
})

const reviewResult = await readFile(join(runDirectory, "artifacts/review-result.json"), "utf8")
if (!reviewResult.includes("合格")) {
  console.log("[prototype-runner] review did not contain approval signal: 合格")
  logFeedbackNode({
    artifact: "artifacts/review-result.json",
    message: "Review 未通过。请根据 review 意见重新规划，并重启本轮 workflow。",
    session: "plan",
  })
  process.exit(1)
}

const finalizeResult = await runCommand({
  command: ["bun", "run", join(workflowDirectory, "checks/fake-finalize.ts"), "--run-dir", runDirectory],
  label: "finalize",
})

if (!finalizeResult.ok) {
  process.exit(finalizeResult.exitCode)
}

console.log("[prototype-runner] workflow reached finalize")

function parseArgs(argv: readonly string[]): CliArgs {
  return {
    runDirectory: readOption(argv, "--run-dir", ".runs/operator-dsl-loop"),
    workflowPath: readOption(argv, "--workflow", "workflows/operator-dsl-loop/workflow.yml"),
  }
}

function readOption(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(name)
  const value = argv[index + 1]
  if (index === -1 || value === undefined) {
    return fallback
  }
  return value
}

function verifyWorkflowContract(workflow: string): void {
  const requiredFragments = [
    "entry: plan",
    "session: plan",
    "session: codegen",
    "session: optimize",
    "session: review",
    "kind: agent_feedback",
    "pass_contains: \"合格\"",
    "checks/fake-correctness.ts",
    "checks/fake-perf.ts",
    "checks/fake-finalize.ts",
  ]

  for (const fragment of requiredFragments) {
    if (!workflow.includes(fragment)) {
      throw new Error(`Workflow placeholder runner expected fragment: ${fragment}`)
    }
  }
}

async function seedRunDirectory(input: {
  readonly runDirectory: string
  readonly workflowDirectory: string
}): Promise<void> {
  const relativePaths = [
    "artifacts/input.json",
    "artifacts/plan-output.md",
    "artifacts/plan-summary.json",
    "artifacts/handoff.codegen.json",
    "artifacts/handoff.codegen.md",
    "artifacts/handoff.codegen.selected.json",
    "artifacts/codegen-report.md",
    "artifacts/review-notes.md",
    "artifacts/review-result.json",
    "generated/operator.dsl",
    "reference/layer_norm.py",
    "rules/operator-rules.md",
    "rules/operator-review.md",
  ]

  await rm(join(input.runDirectory, "artifacts/fake-correctness-attempt.txt"), { force: true })

  for (const relativePath of relativePaths) {
    const sourcePath = join(input.workflowDirectory, relativePath)
    const targetPath = join(input.runDirectory, relativePath)
    if (sourcePath === targetPath) {
      continue
    }
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
  }
}

function logAgentNode(input: {
  readonly prompt: string
  readonly session: string
  readonly stage: string
}): void {
  console.log(`[prototype-runner] agent stage=${input.stage} session=${input.session}`)
  console.log(`[prototype-runner] prompt=${input.prompt}`)
  console.log("[prototype-runner] production runner must start or resume the real agent session here")
}

async function runGateWithFeedback(input: {
  readonly artifact: string
  readonly command: readonly string[]
  readonly gate: string
  readonly maxAttempts: number
  readonly session: string
}): Promise<void> {
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const result = await runCommand({ command: input.command, label: input.gate })
    if (result.ok) {
      return
    }
    logFeedbackNode({
      artifact: input.artifact,
      message: CONTINUE_MESSAGE,
      session: input.session,
    })
  }

  throw new Error(`Gate '${input.gate}' failed after ${input.maxAttempts} attempts`)
}

function logFeedbackNode(input: {
  readonly artifact: string
  readonly message: string
  readonly session: string
}): void {
  console.log(`[prototype-runner] feedback session=${input.session}`)
  console.log(`[prototype-runner] inject artifact=${input.artifact}`)
  console.log(`[prototype-runner] inject message=${input.message}`)
}

async function runCommand(input: {
  readonly command: readonly string[]
  readonly label: string
}): Promise<CommandResult> {
  console.log(`[prototype-runner] command ${input.label}: ${input.command.join(" ")}`)
  const subprocess = Bun.spawn(input.command, {
    stderr: "inherit",
    stdout: "inherit",
  })
  const exitCode = await subprocess.exited
  return { exitCode, ok: exitCode === 0 }
}
