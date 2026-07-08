import { afterEach, describe, expect, test } from "bun:test"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import { deriveRunDirectory, loadManifest } from "../scripts/runtime/contracts"
import { assemblePrompt } from "../scripts/runtime/prompt-assembler"


const repositoryRoot = "/workspace/loop-workflow-kit"

describe("operator-dsl-loop prototype runtime", () => {
  const runDirectories = new Set<string>()
  const workflowDirectories = new Set<string>()

  afterEach(async () => {
    await Promise.all([...runDirectories].map(async (path) => rm(path, { force: true, recursive: true })))
    await Promise.all([...workflowDirectories].map(async (path) => rm(path, { force: true, recursive: true })))
    runDirectories.clear()
    workflowDirectories.clear()
  })

  test("bun run prototype:operator creates session-capable run state", async () => {
    const runDirectory = makeRunDirectory("full-run")
    const result = Bun.spawn([
      "bun",
      "run",
      "prototype:operator",
      "--",
      "--run-dir",
      runDirectory,
      "--fresh-run",
    ], {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdout: "pipe",
    })

    expect(await result.exited).toBe(0)

    const state = JSON.parse(await readFile(join(runDirectory, "artifacts", "state.json"), "utf8")) as { readonly node: string; readonly status: string }
    const review = JSON.parse(await readFile(join(runDirectory, "artifacts", "review-result.json"), "utf8")) as { readonly decision: { readonly approved: boolean } }
    const prompt = await readFile(join(runDirectory, "artifacts", "prompts", "codegen.md"), "utf8")
    const feedbackPrompt = await readFile(join(runDirectory, "artifacts", "prompts", "codegen_feedback.md"), "utf8")
    const sessionEventLog = await readFile(join(runDirectory, "artifacts", "session-events.jsonl"), "utf8")
    const debugGuide = await readFile(join(runDirectory, "artifacts", "prototype-debug-commands.txt"), "utf8")

    expect(state).toEqual({ node: "finalize", status: "completed", workflow: "operator-dsl-loop" })
    expect(review.decision.approved).toBe(true)
    expect(prompt).toContain("# Fixed Stage System Prompt")
    expect(feedbackPrompt).toContain("检验不通过的，请继续修改代码。")
    expect(sessionEventLog).toContain("session-turn")
    expect(debugGuide).toContain("--mode sessions")
    expect(debugGuide).toContain("--stage codegen")
    expect(await Bun.file(join(runDirectory, "sessions", "plan.json")).exists()).toBe(true)
    expect(await Bun.file(join(runDirectory, "sessions", "codegen.json")).exists()).toBe(true)
    expect(await Bun.file(join(runDirectory, "artifacts", "correctness.json")).exists()).toBe(true)
    expect(await Bun.file(join(runDirectory, "artifacts", "perf.json")).exists()).toBe(true)
    expect(await Bun.file(join(runDirectory, "artifacts", "finalize.json")).exists()).toBe(true)
  })

  test("stage replay rewrites cleared stage outputs", async () => {
    const runDirectory = makeRunDirectory("stage-replay")
    await runPrototype(runDirectory)
    const codegenReportPath = join(runDirectory, "artifacts", "codegen-report.md")
    await writeFile(codegenReportPath, "mutated\n")

    const replay = Bun.spawn([
      "bun",
      "run",
      "prototype:operator:stage",
      "--",
      "--run-dir",
      runDirectory,
      "--stage",
      "codegen",
    ], {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdout: "pipe",
    })

    expect(await replay.exited).toBe(0)
    expect(await readFile(codegenReportPath, "utf8")).toContain("Codegen Report")
  })

  test("inspect command prints persisted run summary", async () => {
    const runDirectory = makeRunDirectory("inspect")
    await runPrototype(runDirectory)

    const inspect = Bun.spawn([
      "bun",
      "run",
      "prototype:operator:inspect",
      "--",
      "--run-dir",
      runDirectory,
    ], {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdout: "pipe",
    })
    const stdout = await new Response(inspect.stdout).text()

    expect(await inspect.exited).toBe(0)
    expect(stdout).toContain(`runDirectory=${runDirectory}`)
    expect(stdout).toContain('"node":"finalize"')
    expect(stdout).toContain('"stage":"codegen"')
    expect(stdout).toContain("## review")
  })

  test("sessions command prints persisted session summaries", async () => {
    const runDirectory = makeRunDirectory("sessions")
    await runPrototype(runDirectory)

    const inspect = Bun.spawn([
      "bun",
      "run",
      "prototype:operator:sessions",
      "--",
      "--run-dir",
      runDirectory,
    ], {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdout: "pipe",
    })
    const stdout = await new Response(inspect.stdout).text()

    expect(await inspect.exited).toBe(0)
    expect(stdout).toContain("plan=fake-plan")
    expect(stdout).toContain("codegen=fake-codegen")
    expect(stdout).toContain("promptCount=")
  })

  test("workflow contract advertises structured runtime surfaces", async () => {
    const workflow = await readFile(resolve(repositoryRoot, "workflows/operator-dsl-loop/workflow.yml"), "utf8")
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "workflows/operator-dsl-loop/handoff-manifest.json"), "utf8")) as { readonly decision: { readonly jsonPath: readonly string[] } }
    const inputSchema = JSON.parse(await readFile(resolve(repositoryRoot, "workflows/operator-dsl-loop/input.schema.json"), "utf8")) as { readonly required: readonly string[] }

    expect(workflow).toContain("transport: fake-session")
    expect(workflow).toContain("deriveFromInput: runId")
    expect(workflow).toContain("sessionsCommand:")
    expect(workflow).toContain("clearOnEnter:")
    expect(manifest.decision.jsonPath).toEqual(["decision", "approved"])
    expect(inputSchema.required).toContain("runId")
    expect(inputSchema.required).toContain("sessionMode")
  })

  test("run directory derivation can use multiple stable input fields", async () => {
    const workflowDirectory = makeRunDirectory("derive-run-slug-workflow")
    await mkdir(join(workflowDirectory, "artifacts"), { recursive: true })
    await writeFile(join(workflowDirectory, "artifacts", "input.json"), JSON.stringify({
      targetArtifact: "layer norm/operator.dsl",
      targetBackend: "pyasc",
    }, null, 2))
    await writeFile(join(workflowDirectory, "handoff-manifest.json"), JSON.stringify({
      decision: { approvalSignal: "ok", artifact: "artifacts/review-result.json", equals: true, jsonPath: ["decision", "approved"] },
      gates: {},
      run: {
        defaultRunDirectoryRoot: ".runs/example-loop",
        freshRunMarker: ".example-loop-run",
        inputArtifact: "artifacts/input.json",
        runSlugFromFields: ["targetArtifact", "targetBackend"],
        seedArtifacts: [],
        workflowName: "example-loop",
        workflowVersion: "2026-07-08",
      },
      sessions: {},
      stages: {},
    }, null, 2))

    const runDirectory = await deriveRunDirectory(repositoryRoot, workflowDirectory)
    expect(runDirectory).toBe(resolve(repositoryRoot, ".runs/example-loop/layer-norm-operator.dsl--pyasc"))
  })

  test("scaffold command creates a runnable workflow prototype", async () => {
    const workflowName = "scaffolded-loop"
    const workflowDirectory = resolve(repositoryRoot, "workflows", workflowName)
    workflowDirectories.add(workflowDirectory)
    runDirectories.add(resolve(repositoryRoot, ".runs", workflowName))

    const scaffold = Bun.spawn([
      "bun",
      "run",
      "scaffold:workflow",
      "--",
      "--name",
      workflowName,
      "--workflow-dir",
      `workflows/${workflowName}`,
      "--force",
    ], {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdout: "pipe",
    })
    const scaffoldStdout = await new Response(scaffold.stdout).text()

    expect(await scaffold.exited).toBe(0)
    expect(scaffoldStdout).toContain(`[scaffold] workflow=${workflowName}`)
    expect(await Bun.file(join(workflowDirectory, "workflow.yml")).exists()).toBe(true)
    expect(await Bun.file(join(workflowDirectory, "handoff-manifest.json")).exists()).toBe(true)
    expect(await Bun.file(join(workflowDirectory, "checks", "correctness.ts")).exists()).toBe(true)
    expect(await Bun.file(join(workflowDirectory, "prompts", "plan.md")).exists()).toBe(true)

    const run = Bun.spawn([
      "bun",
      "run",
      "prototype:run",
      "--",
      "--workflow",
      `workflows/${workflowName}/workflow.yml`,
      "--fresh-run",
    ], {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdout: "pipe",
    })
    const runStdout = await new Response(run.stdout).text()
    const expectedRunDirectory = resolve(repositoryRoot, ".runs", workflowName, "generated-output.txt--prototype-backend")

    expect(await run.exited).toBe(0)
    expect(runStdout).toContain(`[prototype-runner] runDirectory=${expectedRunDirectory}`)
    expect(await Bun.file(join(expectedRunDirectory, "artifacts", "state.json")).exists()).toBe(true)
    expect(await Bun.file(join(expectedRunDirectory, "artifacts", "prototype-debug-commands.txt")).exists()).toBe(true)
  })

  test("prompt assembly does not fall back to workflow sample for required run artifacts", async () => {
    const runDirectory = makeRunDirectory("prompt-missing-run-artifact")
    const workflowDirectory = resolve(repositoryRoot, "workflows/operator-dsl-loop")
    const manifest = await loadManifest(workflowDirectory)
    await mkdir(join(runDirectory, "artifacts"), { recursive: true })
    await mkdir(join(runDirectory, "rules"), { recursive: true })
    await mkdir(join(runDirectory, "reference"), { recursive: true })
    await copyFile(join(workflowDirectory, "artifacts", "input.json"), join(runDirectory, "artifacts", "input.json"))
    await copyFile(join(workflowDirectory, "rules", "operator-rules.md"), join(runDirectory, "rules", "operator-rules.md"))

    await expect(
      assemblePrompt({
        runDirectory,
        stage: manifest.stages.optimize,
        stageId: "optimize",
        workflowDirectory,
      }),
    ).rejects.toThrow("Missing required artifact: artifacts/codegen-report.md")
  })

  function makeRunDirectory(name: string): string {
    const path = resolve(repositoryRoot, ".runs", "operator-dsl-loop", `test-${name}`)
    runDirectories.add(path)
    return path
  }

  async function runPrototype(runDirectory: string): Promise<void> {
    await mkdir(join(runDirectory, ".."), { recursive: true }).catch(() => undefined)
    const result = Bun.spawn([
      "bun",
      "run",
      "prototype:operator",
      "--",
      "--run-dir",
      runDirectory,
      "--fresh-run",
    ], {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdout: "pipe",
    })
    expect(await result.exited).toBe(0)
  }
})
