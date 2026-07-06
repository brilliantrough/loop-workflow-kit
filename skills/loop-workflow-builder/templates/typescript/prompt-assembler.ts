import { mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"

type InjectionSection = {
  readonly artifact?: string
  readonly label: string
  readonly promptTemplate?: true
  readonly required: boolean
}

type HandoffManifest = {
  readonly injection: {
    readonly renderOrder: readonly string[]
    readonly sections: readonly InjectionSection[]
  }
  readonly persistence: {
    readonly selectedArtifactsRecord: string
  }
  readonly targetStage: {
    readonly promptTemplate: string
    readonly role: string
    readonly stopCondition: string
  }
}

export async function assemblePromptFromManifest(input: {
  readonly manifestPath: string
  readonly runDirectory: string
  readonly workflowDirectory: string
}): Promise<string> {
  const manifest = parseHandoffManifest(await readFile(input.manifestPath, "utf8"))
  const promptTemplatePath = join(input.workflowDirectory, manifest.targetStage.promptTemplate)
  const sectionMap = new Map(manifest.injection.sections.map((section) => [section.label, section]))
  const renderedSections = await Promise.all(
    manifest.injection.renderOrder.map(async (label) => {
      const section = sectionMap.get(label)
      if (section === undefined) {
        throw new Error(`Missing injection section: ${label}`)
      }

      const body = await readSectionBody({
        promptTemplatePath,
        runDirectory: input.runDirectory,
        section,
        workflowDirectory: input.workflowDirectory,
      })

      return `# ${section.label}\n${body}`
    }),
  )

  const selectedArtifacts = manifest.injection.sections
    .filter((section) => section.artifact !== undefined)
    .map((section) => ({ label: section.label, path: section.artifact }))

  await writeSelectedArtifactsRecord({
    path: join(input.runDirectory, manifest.persistence.selectedArtifactsRecord),
    selectedArtifacts,
  })

  return [
    `# Role\n${manifest.targetStage.role}`,
    ...renderedSections,
    `# Stop Condition\n${manifest.targetStage.stopCondition}`,
  ].join("\n\n")
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

  if (input.section.artifact !== undefined) {
    const artifactPath = join(input.runDirectory, input.section.artifact)
    const artifactFile = Bun.file(artifactPath)
    if (!(await artifactFile.exists())) {
      if (input.section.required) {
        throw new Error(`Missing required artifact: ${input.section.artifact}`)
      }
      return ""
    }
    return readFile(artifactPath, "utf8")
  }

  throw new Error(`Section '${input.section.label}' must define artifact or promptTemplate`)
}

async function writeSelectedArtifactsRecord(input: {
  readonly path: string
  readonly selectedArtifacts: readonly { readonly label: string; readonly path: string }[]
}): Promise<void> {
  await mkdir(dirname(input.path), { recursive: true })
  await Bun.write(input.path, JSON.stringify(input.selectedArtifacts, null, 2))
}

function parseHandoffManifest(raw: string): HandoffManifest {
  return JSON.parse(raw)
}
