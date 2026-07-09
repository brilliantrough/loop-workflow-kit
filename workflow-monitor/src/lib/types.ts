export type WorkflowMonitorStatus =
  | "idle"
  | "ready"
  | "running"
  | "pending"
  | "completed"
  | "failed"
  | "approved"
  | "rejected"

export type WorkflowRunStatus = WorkflowMonitorStatus | "unknown"
export type WorkflowStreamState = "connecting" | "connected" | "reconnecting"
export type WorkflowActivityState = "active" | "stale" | "terminal" | "unknown"

export type WorkflowFileStatus = {
  readonly exists: boolean
  readonly kind: "text" | "image" | "binary" | "directory" | "missing"
  readonly modifiedAt: string | null
  readonly path: string
  readonly sizeBytes: number | null
}

export type WorkflowFilePreview = {
  readonly content: string | null
  readonly kind: "text" | "image" | "binary" | "directory"
  readonly language: string | null
  readonly mediaType: string | null
  readonly modifiedAt: string
  readonly path: string
  readonly rawUrl: string | null
  readonly relativePath: string
  readonly sizeBytes: number
  readonly truncated: boolean
}

export type WorkflowRunRecord = {
  readonly activityState: WorkflowActivityState
  readonly backend: string | null
  readonly completedAt: string | null
  readonly currentNodeId: string | null
  readonly hasSnapshot: boolean
  readonly heartbeatAt: string | null
  readonly id: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly operatorDir: string | null
  readonly runDirectory: string
  readonly startedAt: string | null
  readonly status: WorkflowRunStatus
  readonly subject: string | null
  readonly updatedAt: string
  readonly workflowName: string | null
}

export type WorkflowRunsIndex = {
  readonly defaultRunId: string | null
  readonly runs: readonly WorkflowRunRecord[]
  readonly runsRoot: string
}

export type WorkflowGraphNode = {
  readonly agent?: string | null
  readonly command?: readonly string[] | null
  readonly continuationMessage?: string | null
  readonly decisionArtifact?: string | null
  readonly engine?: string | null
  readonly fail?: string | null
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly layout?: {
    readonly lane?: "mainline" | "repair" | "replan" | "aux"
    readonly x: number
    readonly y: number
  } | null
  readonly maxAttempts?: number | null
  readonly next?: string | null
  readonly pass?: string | null
  readonly promptTemplate?: string | null
  readonly requiredOutputs?: readonly string[] | null
  readonly resultArtifact?: string | null
  readonly selectedArtifactsRecord?: string | null
  readonly session?: string | null
}

export type WorkflowGraphEdge = {
  readonly id: string
  readonly label: string
  readonly route: "next" | "pass" | "fail"
  readonly source: string
  readonly target: string
}

export type WorkflowNodeState = {
  readonly artifactPath?: string | null
  readonly attempts: number
  readonly completedAt?: string | null
  readonly current: boolean
  readonly detail?: string | null
  readonly routeOutcome?: string | null
  readonly sessionId?: string | null
  readonly startedAt?: string | null
  readonly status: WorkflowMonitorStatus
  readonly updatedAt: string
}

export type WorkflowSessionSummary = {
  readonly agent: string
  readonly attachCommand?: string | null
  readonly engine: string
  readonly id?: string | null
  readonly promptCount: number
  readonly stages: readonly string[]
}

export type WorkflowMonitorSnapshot = {
  readonly execution: {
    readonly currentNodeId?: string | null
    readonly currentNodeKind?: string | null
    readonly detail?: string | null
    readonly status: WorkflowMonitorStatus
    readonly updatedAt: string
  }
  readonly graph: {
    readonly edges: readonly WorkflowGraphEdge[]
    readonly nodes: readonly WorkflowGraphNode[]
  }
  readonly nodeStates: Record<string, WorkflowNodeState>
  readonly observer: {
    readonly attachGuidePath?: string | null
    readonly attachLatestCommand?: string | null
    readonly gateReplayTemplate?: string | null
    readonly inspectCommand?: string | null
    readonly serverLogPath?: string | null
    readonly serverOwnedByRunner?: boolean | null
    readonly serverStatePath?: string | null
    readonly serverUrl?: string | null
    readonly sessionsCommand?: string | null
    readonly stageReplayTemplate?: string | null
  }
  readonly recentEvents: ReadonlyArray<{
    readonly artifactPath?: string | null
    readonly detail?: string | null
    readonly exitCode?: number | null
    readonly nodeId: string
    readonly outcome?: string | null
    readonly phase: string
    readonly sequence: number
    readonly timestamp: string
  }>
  readonly runInput: Record<string, unknown>
  readonly sessions: Record<string, WorkflowSessionSummary>
  readonly version: number
  readonly workflow: {
    readonly adapter?: string | null
    readonly completedAt?: string | null
    readonly entryNodeId: string
    readonly heartbeatAt?: string | null
    readonly metadata?: Record<string, unknown> | null
    readonly name: string
    readonly runDirectory: string
    readonly startedAt?: string | null
    readonly status: WorkflowMonitorStatus
    readonly transport?: string | null
    readonly updatedAt: string
    readonly version: string
    readonly workflowPath: string
  }
}
