import { readFile } from "node:fs/promises"

type PromptPart = {
  readonly label: string
  readonly path: string
}

export async function assemblePrompt(parts: readonly PromptPart[]): Promise<string> {
  const rendered = await Promise.all(
    parts.map(async (part) => `# ${part.label}\n${await readFile(part.path, "utf8")}`),
  )
  return rendered.join("\n\n")
}
