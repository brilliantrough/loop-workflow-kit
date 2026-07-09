import { join } from "node:path"

import type { SessionRecord } from "./fake-session-server"
import type { WorkflowManifest } from "./contracts"
import { appendJsonLine, readJsonObject, writeJson } from "./persistence"

const SNAPSHOT_FILENAME = "workflow-monitor.snapshot.json"
const EVENTS_FILENAME = "workflow-monitor.events.jsonl"

type WorkflowMonitorStatus =
  | "idle"
  | "ready"
  | "running"
  | "pending"
  | "completed"
  | "failed"
  | "approved"
  | "rejected"

export class WorkflowMonitorStore {
  private readonly eventsPath: string
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sequence = 0
  private readonly snapshotPath: string
  private writeQueue: Promise<void> = Promise.resolve()

  private snapshot: Record<string, unknown>

  constructor(input: {
    readonly debugSurface: {
      readonly gateReplayTemplate: string
      readonly inspectCommand: string
      readonly sessionsCommand: string
      readonly stageReplayTemplate: string
    }
    readonly manifest: WorkflowManifest
    readonly runDirectory: string
    readonly workflowPath: string
  }) {
    this.snapshotPath = join(input.runDirectory, "artifacts", SNAPSHOT_FILENAME)
    this.eventsPath = join(input.runDirectory, "artifacts", EVENTS_FILENAME)
    this.snapshot = {
      version: 1,
      workflow: {
        adapter: "fake-session",
        entryNodeId: Object.keys(input.manifest.stages)[0] ?? "plan",
        name: input.manifest.run.workflowName,
        runDirectory: input.runDirectory,
        startedAt: now(),
        completedAt: null,
        heartbeatAt: now(),
        status: "ready",
        transport: "fake-session",
        updatedAt: now(),
        version: input.manifest.run.workflowVersion,
        workflowPath: input.workflowPath,
      },
      runInput: {},
      graph: {
        edges: buildEdges(input.manifest, input.runDirectory),
        nodes: buildNodes(input.manifest, input.runDirectory),
      },
      execution: {
        currentNodeId: null,
        currentNodeKind: null,
        detail: "run directory seeded",
        status: "ready",
        updatedAt: now(),
      },
      observer: {
        attachGuidePath: join(input.runDirectory, "artifacts", "prototype-debug-commands.txt"),
        attachLatestCommand: null,
        gateReplayTemplate: input.debugSurface.gateReplayTemplate,
        inspectCommand: input.debugSurface.inspectCommand,
        serverLogPath: null,
        serverOwnedByRunner: true,
        serverStatePath: null,
        serverUrl: null,
        sessionsCommand: input.debugSurface.sessionsCommand,
        stageReplayTemplate: input.debugSurface.stageReplayTemplate,
      },
      sessions: {},
      nodeStates: Object.fromEntries(
        [
          ...Object.keys(input.manifest.stages),
          ...Object.keys(input.manifest.gates),
        ].map((nodeId) => [nodeId, initialNodeState()]),
      ),
      recentEvents: [],
    }
  }

  async initialize(): Promise<void> {
    this.snapshot.runInput = await this.readRunInput()
    const runInput = this.snapshot.runInput as Record<string, unknown>
    this.snapshot.workflow.metadata = {
      backend: runInput.backend ?? null,
      subject: runInput.operatorDir ?? runInput.runName ?? null,
    }
    await this.writeSnapshot()
    await this.appendEvent({ detail: "run directory seeded", nodeId: this.snapshot.workflow.entryNodeId as string, phase: "seeded" })
  }

  startHeartbeat(intervalMs = 10_000): void {
    if (this.heartbeatTimer !== null) {
      return
    }
    this.heartbeatTimer = setInterval(() => {
      const workflow = this.snapshot.workflow as Record<string, unknown>
      workflow.heartbeatAt = now()
      void this.writeSnapshot()
    }, intervalMs)
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer === null) {
      return
    }
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  async syncSessions(input: {
    readonly manifest: WorkflowManifest
    readonly records: readonly SessionRecord[]
  }): Promise<void> {
    const nextSessions: Record<string, unknown> = {}
    for (const [sessionName, sessionContract] of Object.entries(input.manifest.sessions)) {
      const record = input.records.find((item) => item.stage === sessionName)
      nextSessions[sessionName] = {
        agent: sessionContract.agent,
        attachCommand: null,
        engine: sessionContract.engine,
        id: record?.id ?? null,
        promptCount: record?.promptCount ?? 0,
        stages: Object.entries(input.manifest.stages)
          .filter(([, stage]) => stage.session === sessionName)
          .map(([stageId]) => stageId),
      }
    }
    this.snapshot.sessions = nextSessions
    await this.touchSnapshot()
  }

  async stageStarted(input: {
    readonly attempt: number
    readonly sessionId: string
    readonly stageId: string
  }): Promise<void> {
    const state = this.nodeState(input.stageId)
    state.attempts = input.attempt
    state.current = true
    state.sessionId = input.sessionId
    state.startedAt = now()
    state.status = "running"
    await this.setExecution({ currentNodeId: input.stageId, detail: `${input.stageId} running`, status: "running" })
    await this.appendEvent({ detail: `attempt=${input.attempt}`, nodeId: input.stageId, phase: "stage_started" })
  }

  async stageCompleted(input: {
    readonly outputsReady: boolean
    readonly stageId: string
  }): Promise<void> {
    const state = this.nodeState(input.stageId)
    state.completedAt = now()
    state.current = false
    state.detail = input.outputsReady ? "required outputs ready" : "waiting for required outputs"
    state.routeOutcome = input.outputsReady ? "ready" : "pending"
    state.status = input.outputsReady ? "completed" : "pending"
    await this.setExecution({
      currentNodeId: null,
      detail: state.detail as string,
      status: input.outputsReady ? "running" : "pending",
    })
    await this.appendEvent({
      detail: state.detail as string,
      nodeId: input.stageId,
      outcome: state.routeOutcome as string,
      phase: input.outputsReady ? "stage_completed" : "stage_pending",
    })
  }

  async gateStarted(gateId: string): Promise<void> {
    const state = this.nodeState(gateId)
    state.attempts = Number(state.attempts ?? 0) + 1
    state.current = true
    state.startedAt = now()
    state.status = "running"
    await this.setExecution({ currentNodeId: gateId, detail: `${gateId} running`, status: "running" })
    await this.appendEvent({ nodeId: gateId, phase: "gate_started" })
  }

  async gateCompleted(input: {
    readonly exitCode: number
    readonly gateId: string
    readonly resultArtifact: string
  }): Promise<void> {
    const ok = input.exitCode === 0
    const state = this.nodeState(input.gateId)
    state.completedAt = now()
    state.current = false
    state.detail = `exit_code=${input.exitCode}`
    state.routeOutcome = ok ? "pass" : "fail"
    state.status = ok ? "completed" : "failed"
    state.artifactPath = join(this.snapshot.workflow.runDirectory as string, input.resultArtifact)
    await this.setExecution({
      currentNodeId: null,
      detail: state.detail as string,
      status: ok ? "running" : "failed",
    })
    await this.appendEvent({
      artifactPath: state.artifactPath as string,
      detail: state.detail as string,
      exitCode: input.exitCode,
      nodeId: input.gateId,
      outcome: state.routeOutcome as string,
      phase: "gate_completed",
    })
  }

  async reviewDecision(input: {
    readonly approved: boolean
    readonly artifactPath: string
  }): Promise<void> {
    const state = this.nodeState("review")
    state.artifactPath = input.artifactPath
    state.detail = input.approved ? "review approved" : "review rejected"
    state.routeOutcome = input.approved ? "pass" : "fail"
    state.status = input.approved ? "approved" : "rejected"
    await this.setExecution({
      currentNodeId: null,
      detail: state.detail as string,
      status: input.approved ? "running" : "failed",
    })
    await this.appendEvent({
      artifactPath: input.artifactPath,
      detail: state.detail as string,
      nodeId: "review",
      outcome: state.routeOutcome as string,
      phase: "decision",
    })
  }

  async workflowCompleted(input: {
    readonly detail: string
    readonly nodeId: string
    readonly status: WorkflowMonitorStatus
  }): Promise<void> {
    this.snapshot.workflow.status = input.status
    this.snapshot.workflow.completedAt = now()
    await this.setExecution({ currentNodeId: input.nodeId, detail: input.detail, status: input.status })
    await this.appendEvent({
      detail: input.detail,
      nodeId: input.nodeId,
      outcome: input.status,
      phase: "workflow_completed",
    })
  }

  async workflowFailed(input: {
    readonly detail: string
    readonly nodeId: string
  }): Promise<void> {
    this.snapshot.workflow.status = "failed"
    this.snapshot.workflow.completedAt = now()
    await this.setExecution({ currentNodeId: input.nodeId, detail: input.detail, status: "failed" })
    await this.appendEvent({
      detail: input.detail,
      nodeId: input.nodeId,
      outcome: "failed",
      phase: "workflow_failed",
    })
  }

  async workflowPending(input: {
    readonly detail: string
    readonly nodeId: string
  }): Promise<void> {
    this.snapshot.workflow.status = "pending"
    await this.setExecution({ currentNodeId: input.nodeId, detail: input.detail, status: "pending" })
    await this.appendEvent({
      detail: input.detail,
      nodeId: input.nodeId,
      outcome: "pending",
      phase: "workflow_pending",
    })
  }

  private async setExecution(input: {
    readonly currentNodeId: string | null
    readonly detail: string
    readonly status: WorkflowMonitorStatus
  }): Promise<void> {
    this.snapshot.execution = {
      currentNodeId: input.currentNodeId,
      currentNodeKind: input.currentNodeId ? this.nodeKind(input.currentNodeId) : null,
      detail: input.detail,
      status: input.status,
      updatedAt: now(),
    }
    this.snapshot.workflow.status = input.status
    this.snapshot.workflow.updatedAt = this.snapshot.execution.updatedAt
    await this.writeSnapshot()
  }

  private async appendEvent(input: {
    readonly artifactPath?: string
    readonly detail?: string
    readonly exitCode?: number
    readonly nodeId: string
    readonly outcome?: string
    readonly phase: string
  }): Promise<void> {
    this.sequence += 1
    const event = {
      artifactPath: input.artifactPath ?? null,
      detail: input.detail ?? null,
      exitCode: input.exitCode ?? null,
      nodeId: input.nodeId,
      outcome: input.outcome ?? null,
      phase: input.phase,
      sequence: this.sequence,
      timestamp: now(),
    }
    await appendJsonLine(this.eventsPath, event)
    const recent = Array.isArray(this.snapshot.recentEvents) ? [...(this.snapshot.recentEvents as unknown[])] : []
    recent.push(event)
    this.snapshot.recentEvents = recent.slice(-40)
    this.nodeState(input.nodeId).updatedAt = event.timestamp
    await this.writeSnapshot()
  }

  private nodeState(nodeId: string): Record<string, unknown> {
    const nodeStates = this.snapshot.nodeStates as Record<string, Record<string, unknown>>
    if (nodeStates[nodeId] === undefined) {
      nodeStates[nodeId] = initialNodeState()
    }
    return nodeStates[nodeId]
  }

  private nodeKind(nodeId: string): string | null {
    const nodes = this.snapshot.graph.nodes as Array<Record<string, unknown>>
    return (nodes.find((node) => node.id === nodeId)?.kind as string | undefined) ?? null
  }

  private async writeSnapshot(): Promise<void> {
    const payload = structuredClone(this.snapshot)
    const nextWrite = this.writeQueue.catch(() => undefined).then(async () => writeJson(this.snapshotPath, payload))
    this.writeQueue = nextWrite
    await nextWrite
  }

  private async touchSnapshot(): Promise<void> {
    this.snapshot.workflow.updatedAt = now()
    await this.writeSnapshot()
  }

  private async readRunInput(): Promise<Record<string, unknown>> {
    try {
      return await readJsonObject<Record<string, unknown>>(join(this.snapshot.workflow.runDirectory as string, "artifacts", "input.json"))
    } catch {
      return {}
    }
  }
}

function buildNodes(manifest: WorkflowManifest, runDirectory: string): readonly Record<string, unknown>[] {
  const stageNodes = Object.entries(manifest.stages).map(([stageId, stage]) => ({
    agent: manifest.sessions[stage.session]?.agent ?? null,
    continuationMessage: stage.continuationMessage ?? null,
    decisionArtifact: stage.requiredOutputs.includes(manifest.decision.artifact) ? join(runDirectory, manifest.decision.artifact) : null,
    engine: manifest.sessions[stage.session]?.engine ?? null,
    fail: stage.routing.onFailure ?? null,
    id: stageId,
    kind: stage.continuationMessage || stageId.endsWith("_feedback") ? "agent_feedback" : "agent",
    label: stageId.replaceAll("_", " "),
    next: stage.routing.onSuccess ?? null,
    promptTemplate: stage.promptTemplate,
    requiredOutputs: stage.requiredOutputs.map((value) => join(runDirectory, value)),
    selectedArtifactsRecord: join(runDirectory, stage.persistence.selectedArtifactsRecord),
    session: stage.session,
  }))

  const gateNodes = Object.entries(manifest.gates).map(([gateId, gate]) => ({
    command: [...gate.command],
    fail: gate.fail ?? null,
    id: gateId,
    kind: "gate",
    label: gateId.replaceAll("_", " "),
    maxAttempts: gate.maxAttempts,
    pass: gate.pass ?? null,
    resultArtifact: join(runDirectory, gate.resultArtifact),
  }))

  return [...stageNodes, ...gateNodes]
}

function buildEdges(manifest: WorkflowManifest, _runDirectory: string): readonly Record<string, unknown>[] {
  const edges: Array<Record<string, unknown>> = []
  for (const [stageId, stage] of Object.entries(manifest.stages)) {
    if (stage.routing.onSuccess) {
      edges.push({ id: `${stageId}--next--${stage.routing.onSuccess}`, label: "next", route: "next", source: stageId, target: stage.routing.onSuccess })
    }
    if (stage.routing.onFailure) {
      edges.push({ id: `${stageId}--fail--${stage.routing.onFailure}`, label: "fail", route: "fail", source: stageId, target: stage.routing.onFailure })
    }
  }
  for (const [gateId, gate] of Object.entries(manifest.gates)) {
    if (gate.pass) {
      edges.push({ id: `${gateId}--pass--${gate.pass}`, label: "pass", route: "pass", source: gateId, target: gate.pass })
    }
    if (gate.fail) {
      edges.push({ id: `${gateId}--fail--${gate.fail}`, label: "fail", route: "fail", source: gateId, target: gate.fail })
    }
  }
  return edges
}

function initialNodeState(): Record<string, unknown> {
  return {
    attempts: 0,
    completedAt: null,
    current: false,
    detail: null,
    routeOutcome: null,
    sessionId: null,
    startedAt: null,
    status: "idle",
    updatedAt: now(),
  }
}

function now(): string {
  return new Date().toISOString()
}
