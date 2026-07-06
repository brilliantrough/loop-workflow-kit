import { readFile } from "node:fs/promises"
import { join } from "node:path"

type PromptAssemblyInput = {
  readonly artifacts: readonly string[]
  readonly promptTemplatePath: string
  readonly runDirectory: string
  readonly runInputPath: string
  readonly stageId: string
}

export async function assemblePrompt(input: PromptAssemblyInput): Promise<string> {
  const [template, runInput, artifacts] = await Promise.all([
    readFile(input.promptTemplatePath, "utf8"),
    readFile(input.runInputPath, "utf8"),
    Promise.all(
      input.artifacts.map(async (artifactPath) => ({
        path: artifactPath,
        value: await readFile(join(input.runDirectory, artifactPath), "utf8"),
      })),
    ),
  ])

  return [
    `# Stage\n${input.stageId}`,
    `# Run Input\n${runInput}`,
    `# Instructions\n${template}`,
    ...artifacts.map((artifact) => `# Artifact: ${artifact.path}\n${artifact.value}`),
  ].join("\n\n")
}
