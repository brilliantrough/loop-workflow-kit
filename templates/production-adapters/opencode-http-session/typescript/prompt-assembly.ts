import { readFile, rm } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

import type { InjectionSection, StageContract, WorkflowBundle } from "./contracts"
import { writeJson, writeText } from "./json-store"

const WORKFLOW_LOCAL_PREFIXES = ["rules/", "prompts/", "reference/"]

export async function renderPrompt(input: {
  readonly attempt: number
  readonly bundle: WorkflowBundle
  readonly repoRoot: string
  readonly runDirectory: string
  readonly stage: string
}): Promise<{ readonly promptPath: string; readonly text: string }> {
  const stageContract = input.bundle.manifest.stages[input.stage]
  if (stageContract === undefined) {
    throw new Error(`unknown stage: ${input.stage}`)
  }
  const promptTemplatePath = join(input.bundle.workflowRoot, stageContract.promptTemplate)
  const sections: string[] = [renderRunnerContext(input.stage, stageContract, input.repoRoot, input.runDirectory)]
  const selectedArtifacts: { label: string; path: string }[] = []
  for (const label of stageContract.injection.renderOrder) {
    const section = findSection(stageContract, label, input.stage)
    const rendered = await readSectionBody({
      bundle: input.bundle,
      promptTemplatePath,
      repoRoot: input.repoRoot,
      runDirectory: input.runDirectory,
      section,
    })
    if (rendered === undefined) {
      continue
    }
    sections.push(`# ${section.label}\n\n${rendered.body}`)
    if (rendered.path !== undefined) {
      selectedArtifacts.push({ label: section.label, path: displayPath(rendered.path, input.repoRoot) })
    }
  }
  if (stageContract.continuationMessage !== undefined) {
    sections.push(`# Continuation Message\n\n${stageContract.continuationMessage}`)
  }
  const promptPath = join(input.runDirectory, "artifacts", "prompts", `${input.stage}-${input.attempt}.md`)
  const text = `${sections.filter((section) => section.trim().length > 0).join("\n\n")}\n`
  await writeText(promptPath, text)
  await writeJson(join(input.runDirectory, stageContract.persistence.selectedArtifactsRecord), selectedArtifacts)
  return { promptPath, text }
}

export async function clearStageOutputs(input: {
  readonly bundle: WorkflowBundle
  readonly repoRoot: string
  readonly runDirectory: string
  readonly stage: string
}): Promise<void> {
  const stageContract = input.bundle.manifest.stages[input.stage]
  if (stageContract === undefined) {
    throw new Error(`unknown stage: ${input.stage}`)
  }
  for (const spec of stageContract.clearOnEnter) {
    await rm(resolveContractPath(spec, input.bundle, input.repoRoot, input.runDirectory), { force: true, recursive: true })
  }
}

export async function ensureStageOutputs(input: {
  readonly bundle: WorkflowBundle
  readonly repoRoot: string
  readonly runDirectory: string
  readonly stage: string
}): Promise<void> {
  const missing: string[] = []
  for (const path of requiredOutputPaths(input)) {
    if (!(await Bun.file(path).exists())) {
      missing.push(path)
    }
  }
  if (missing.length > 0) {
    throw new Error(`stage ${input.stage} is missing required outputs: ${missing.join(", ")}`)
  }
}

export function requiredOutputPaths(input: {
  readonly bundle: WorkflowBundle
  readonly repoRoot: string
  readonly runDirectory: string
  readonly stage: string
}): string[] {
  const stageContract = input.bundle.manifest.stages[input.stage]
  if (stageContract === undefined) {
    throw new Error(`unknown stage: ${input.stage}`)
  }
  return stageContract.requiredOutputs.map((spec) => resolveContractPath(spec, input.bundle, input.repoRoot, input.runDirectory))
}

function resolveContractPath(spec: string, bundle: WorkflowBundle, repoRoot: string, runDirectory: string): string {
  if (WORKFLOW_LOCAL_PREFIXES.some((prefix) => spec.startsWith(prefix))) {
    return join(bundle.workflowRoot, spec)
  }
  if (spec.startsWith("/")) {
    return spec
  }
  return join(runDirectory, spec)
}

function renderRunnerContext(stage: string, stageContract: StageContract, repoRoot: string, runDirectory: string): string {
  return [
    "## Runner Context",
    "",
    `- Stage key: \`${stage}\``,
    `- Repository root: \`${repoRoot}\``,
    `- Run directory: \`${runDirectory}\``,
    "- Required outputs:",
    ...stageContract.requiredOutputs.map((output) => `- ${output}`),
  ].join("\n")
}

async function readSectionBody(input: {
  readonly bundle: WorkflowBundle
  readonly promptTemplatePath: string
  readonly repoRoot: string
  readonly runDirectory: string
  readonly section: InjectionSection
}): Promise<{ readonly body: string; readonly path?: string } | undefined> {
  if (input.section.promptTemplate === true) {
    return { body: await readFile(input.promptTemplatePath, "utf8") }
  }
  if (input.section.artifact === undefined) {
    throw new Error(`Section '${input.section.label}' must define artifact or promptTemplate`)
  }
  const artifactPath = resolveContractPath(input.section.artifact, input.bundle, input.repoRoot, input.runDirectory)
  if (await Bun.file(artifactPath).exists()) {
    return { body: await formatArtifactBody(artifactPath), path: artifactPath }
  }
  if (input.section.required) {
    throw new Error(`Missing required artifact: ${input.section.artifact}`)
  }
  return undefined
}

async function formatArtifactBody(path: string): Promise<string> {
  if (path.endsWith(".json")) {
    return `\`\`\`json\n${JSON.stringify(JSON.parse(await readFile(path, "utf8")), null, 2)}\n\`\`\``
  }
  return `\`\`\`text\n${await readFile(path, "utf8")}\n\`\`\``
}

function displayPath(path: string, repoRoot: string): string {
  const relativePath = relative(repoRoot, resolve(path))
  return relativePath.startsWith("..") ? path : relativePath
}

function findSection(stage: StageContract, label: string, stageId: string): InjectionSection {
  const section = stage.injection.sections.find((candidate) => candidate.label === label)
  if (section === undefined) {
    throw new Error(`Missing injection section '${label}' for stage '${stageId}'`)
  }
  return section
}
