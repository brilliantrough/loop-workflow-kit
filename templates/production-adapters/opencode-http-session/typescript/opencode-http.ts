export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type OpencodeHttpConfig = {
  readonly baseUrl: string
  readonly password?: string
  readonly timeoutMs: number
  readonly username?: string
}

export type SessionCreateResult = {
  readonly sessionId: string
  readonly title?: string
}

export class OpencodeHttpError extends Error {}

export class OpencodeHttpClient {
  constructor(private readonly config: OpencodeHttpConfig) {}

  async health(): Promise<Record<string, unknown>> {
    return this.requestObject("GET", "/global/health")
  }

  async getSession(sessionId: string): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.requestObject("GET", `/session/${sessionId}`)
    } catch (error) {
      if (error instanceof OpencodeHttpError && error.message.includes("HTTP 404")) {
        return undefined
      }
      throw error
    }
  }

  async createSession(title: string): Promise<SessionCreateResult> {
    const payload = await this.requestObject("POST", "/session", { title })
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      throw new OpencodeHttpError("session create response missing string id")
    }
    return { sessionId: payload.id, title: typeof payload.title === "string" ? payload.title : undefined }
  }

  async listMessages(sessionId: string): Promise<readonly Record<string, unknown>[]> {
    const payload = await this.requestJson("GET", `/session/${sessionId}/message`)
    if (!Array.isArray(payload)) {
      throw new OpencodeHttpError(`expected JSON array for /session/${sessionId}/message`)
    }
    return payload.map((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new OpencodeHttpError(`expected message object at index ${index}`)
      }
      return item as Record<string, unknown>
    })
  }

  async sendPromptAsync(sessionId: string, input: { readonly agent: string; readonly prompt: string }): Promise<void> {
    await this.requestVoid("POST", `/session/${sessionId}/prompt_async`, {
      agent: input.agent,
      parts: [{ type: "text", text: input.prompt }],
    })
  }

  private async requestObject(method: string, path: string, body?: JsonValue): Promise<Record<string, unknown>> {
    const payload = await this.requestJson(method, path, body)
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new OpencodeHttpError(`expected JSON object for ${method} ${path}`)
    }
    return payload as Record<string, unknown>
  }

  private async requestVoid(method: string, path: string, body?: JsonValue): Promise<void> {
    await this.request(method, path, body)
  }

  private async requestJson(method: string, path: string, body?: JsonValue): Promise<JsonValue> {
    const text = await this.request(method, path, body)
    try {
      return JSON.parse(text) as JsonValue
    } catch (error) {
      throw new OpencodeHttpError(`invalid JSON response for ${method} ${path}: ${String(error)}`)
    }
  }

  private async request(method: string, path: string, body?: JsonValue): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const headers: Record<string, string> = { Accept: "application/json" }
    let requestBody: string | undefined
    if (body !== undefined) {
      headers["Content-Type"] = "application/json"
      requestBody = JSON.stringify(body)
    }
    const auth = basicAuthHeader(this.config.username, this.config.password)
    if (auth !== undefined) {
      headers.Authorization = auth
    }
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
        body: requestBody,
        headers,
        method,
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new OpencodeHttpError(`HTTP ${response.status} for ${method} ${path}: ${text}`)
      }
      return text
    } finally {
      clearTimeout(timeout)
    }
  }
}

function basicAuthHeader(username?: string, password?: string): string | undefined {
  if (password === undefined) {
    return undefined
  }
  return `Basic ${Buffer.from(`${username ?? "opencode"}:${password}`).toString("base64")}`
}
