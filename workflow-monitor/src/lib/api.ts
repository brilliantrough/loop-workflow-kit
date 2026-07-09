import type {
  WorkflowFilePreview,
  WorkflowFileStatus,
  WorkflowMonitorSnapshot,
  WorkflowRunsIndex,
  WorkflowStreamState,
} from "./types"

export class MonitorApiError extends Error {
  readonly code: string | null

  constructor(message: string, code: string | null = null) {
    super(message)
    this.code = code
    this.name = "MonitorApiError"
  }
}

export async function fetchRuns(): Promise<WorkflowRunsIndex> {
  const response = await fetch("/api/runs")
  if (!response.ok) {
    throw await responseError(response)
  }
  return (await response.json()) as WorkflowRunsIndex
}

export async function fetchSnapshot(runId: string): Promise<WorkflowMonitorSnapshot> {
  const response = await fetch(`/api/snapshot?run=${encodeURIComponent(runId)}`)
  if (!response.ok) {
    throw await responseError(response)
  }
  return parseSnapshotPayload(await response.json())
}

export async function fetchFilePreview(path: string): Promise<WorkflowFilePreview> {
  const response = await fetch(`/api/file/preview?path=${encodeURIComponent(path)}`)
  if (!response.ok) {
    throw await responseError(response)
  }
  return (await response.json()) as WorkflowFilePreview
}

export async function fetchFileStatuses(paths: readonly string[]): Promise<readonly WorkflowFileStatus[]> {
  if (paths.length === 0) {
    return []
  }
  const response = await fetch("/api/files/status", {
    body: JSON.stringify({ paths }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  if (!response.ok) {
    throw await responseError(response)
  }
  const payload = (await response.json()) as { files?: unknown }
  if (!Array.isArray(payload.files)) {
    throw new MonitorApiError("Invalid file status response", "invalid_file_status_response")
  }
  return payload.files as readonly WorkflowFileStatus[]
}

export function subscribeToRuns(input: {
  readonly onError: (error: Error) => void
  readonly onStreamStateChange: (state: WorkflowStreamState) => void
  readonly onRuns: (runs: WorkflowRunsIndex) => void
}): () => void {
  const source = new EventSource("/api/runs/stream")
  source.addEventListener("open", () => {
    input.onStreamStateChange("connected")
  })
  source.addEventListener("runs", (event) => {
    try {
      input.onStreamStateChange("connected")
      input.onRuns(JSON.parse((event as MessageEvent<string>).data) as WorkflowRunsIndex)
    } catch (error) {
      input.onError(error instanceof Error ? error : new Error(String(error)))
    }
  })
  source.addEventListener("error", () => {
    input.onStreamStateChange("reconnecting")
  })
  return () => {
    source.close()
  }
}

export function subscribeToSnapshot(
  runId: string,
  input: {
    readonly onError: (error: Error) => void
    readonly onStreamStateChange: (state: WorkflowStreamState) => void
    readonly onSnapshot: (snapshot: WorkflowMonitorSnapshot) => void
  },
): () => void {
  const source = new EventSource(`/api/stream?run=${encodeURIComponent(runId)}`)
  source.addEventListener("open", () => {
    input.onStreamStateChange("connected")
  })
  source.addEventListener("snapshot", (event) => {
    try {
      input.onStreamStateChange("connected")
      input.onSnapshot(parseSnapshotPayload(JSON.parse((event as MessageEvent<string>).data)))
    } catch (error) {
      input.onError(error instanceof Error ? error : new Error(String(error)))
    }
  })
  source.addEventListener("snapshot-error", (event) => {
    input.onError(parseEventError(event as MessageEvent<string>))
  })
  source.addEventListener("error", () => {
    input.onStreamStateChange("reconnecting")
  })
  return () => {
    source.close()
  }
}

function parseSnapshotPayload(value: unknown): WorkflowMonitorSnapshot {
  if (!isRecord(value)) {
    throw new MonitorApiError("Workflow snapshot must be a JSON object", "invalid_snapshot")
  }
  const workflow = value.workflow
  const execution = value.execution
  const graph = value.graph
  if (
    !isRecord(workflow) ||
    typeof workflow.name !== "string" ||
    typeof workflow.runDirectory !== "string" ||
    typeof workflow.entryNodeId !== "string" ||
    !isRecord(execution) ||
    typeof execution.status !== "string" ||
    !isRecord(graph) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    !isRecord(value.nodeStates) ||
    !isRecord(value.sessions) ||
    !Array.isArray(value.recentEvents)
  ) {
    throw new MonitorApiError("Workflow snapshot is missing required contract fields", "invalid_snapshot")
  }
  return value as WorkflowMonitorSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseEventError(event: MessageEvent<string>): MonitorApiError {
  try {
    const payload = JSON.parse(event.data) as { error?: unknown; message?: unknown }
    return new MonitorApiError(
      typeof payload.message === "string" ? payload.message : "workflow monitor event error",
      typeof payload.error === "string" ? payload.error : null,
    )
  } catch {
    return new MonitorApiError(event.data || "workflow monitor event error")
  }
}

async function responseError(response: Response): Promise<MonitorApiError> {
  const text = await response.text()
  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown }
    return new MonitorApiError(
      typeof payload.message === "string" ? payload.message : text || response.statusText,
      typeof payload.error === "string" ? payload.error : null,
    )
  } catch {
    return new MonitorApiError(text || response.statusText)
  }
}
