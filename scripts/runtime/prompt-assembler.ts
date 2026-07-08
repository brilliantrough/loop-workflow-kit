import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { InjectionSection, StageContract } from "./contracts"
import { appendJsonLine, writeJson } from "./persistence"

export async function assemblePrompt(input: {
  readonly runDirectory: string
  readonly stageId: string
  readonly stage: StageContract
  readonly workflowDirectory: string
}): Promise<{ readonly promptPath: string; readonly text: string }> {
  const promptTemplatePath = join(input.workflowDirectory, input.stage.promptTemplate)
  const renderedSections = await Promise.all(
    input.stage.injection.renderOrder.map(async (label) => {
      const section = input.stage.injection.sections.find((candidate) => candidate.label === label)
      if (section === undefined) {
        throw new Error(`Missing injection section '${label}' for stage '${input.stageId}'`)
      }
      const body = await readSectionBody({ promptTemplatePath, runDirectory: input.runDirectory, section: section, workflowDirectory: input.workflowDirectory })
      return `# ${section.label}\n${body}`
    }),
  )

  const selectedArtifacts = input.stage.injection.sections
    .filter((section) => section.artifact !== undefined)
    .map((section) => ({ label: section.label, path: section.artifact }))

  await writeJson(join(input.runDirectory, input.stage.persistence.selectedArtifactsRecord), selectedArtifacts)
  const promptText = [
    ...renderedSections,
    input.stage.continuationMessage === undefined ? "" : `# Continuation Message\n${input.stage.continuationMessage}`,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n")
  const promptPath = join(input.runDirectory, "artifacts", "prompts", `${input.stageId}.md`)
  await appendJsonLine(join(input.runDirectory, "artifacts", "session-events.jsonl"), {
    kind: "prompt-assembled",
    promptPath,
    stage: input.stageId,
  })
  await Bun.write(promptPath, promptText)
  return { promptPath, text: promptText }
}

async function readSectionBody(input: {
  readonly promptTemplatePath: string
  readonly runDirectory: string
  readonly section: InjectionSection
  readonly workflowDirectory: string
}): Promise<string> {
  if (input.section.promptTemplate === true) {
    return readFile(input.promptTemplatePath, "utf8")
  }
  if (input.section.artifact === undefined) {
    throw new Error(`Section '${input.section.label}' must define artifact or promptTemplate`)
  }
  const runArtifactPath = join(input.runDirectory, input.section.artifact)
  if (await Bun.file(runArtifactPath).exists()) {
    return readFile(runArtifactPath, "utf8")
  }
  if (input.section.artifact.startsWith("rules/") || input.section.artifact.startsWith("reference/")) {
    const workflowArtifactPath = join(input.workflowDirectory, input.section.artifact)
    if (await Bun.file(workflowArtifactPath).exists()) {
      return readFile(workflowArtifactPath, "utf8")
    }
  }
  if (input.section.required) {
    throw new Error(`Missing required artifact: ${input.section.artifact}`)
  }
  return ""
}
