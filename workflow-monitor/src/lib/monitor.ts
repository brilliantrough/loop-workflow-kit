import type {
  WorkflowActivityState,
  WorkflowNodeState,
  WorkflowRunRecord,
  WorkflowRunStatus,
} from "./types"

export type RunFilter = "all" | "active" | "stale" | "failed" | "finished"
export type RunSort = "updated" | "started" | "duration" | "name"

export function filterAndSortRuns(
  runs: readonly WorkflowRunRecord[],
  input: { readonly filter: RunFilter; readonly query: string; readonly sort: RunSort },
): WorkflowRunRecord[] {
  const query = input.query.trim().toLocaleLowerCase()
  return runs
    .filter((run) => matchesFilter(run, input.filter))
    .filter((run) => {
      if (!query) {
        return true
      }
      return [run.id, run.workflowName, run.subject, run.operatorDir, run.backend, run.currentNodeId, JSON.stringify(run.metadata)]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLocaleLowerCase().includes(query))
    })
    .sort((left, right) => compareRuns(left, right, input.sort))
}

export function formatDuration(valueMs: number | null): string {
  if (valueMs === null || !Number.isFinite(valueMs) || valueMs < 0) {
    return "n/a"
  }
  const totalSeconds = Math.floor(valueMs / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${seconds}s`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) {
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function formatRelativeTime(value: string | null | undefined, nowMs: number): string {
  const timestamp = parseTimestamp(value)
  if (timestamp === null) {
    return "n/a"
  }
  const delta = Math.max(0, nowMs - timestamp)
  if (delta < 5_000) {
    return "just now"
  }
  return `${formatDuration(delta)} ago`
}

export function nodeDurationMs(state: WorkflowNodeState, nowMs: number): number | null {
  return elapsedMs(state.startedAt, state.completedAt, nowMs)
}

export function runDurationMs(run: WorkflowRunRecord, nowMs: number): number | null {
  return elapsedMs(run.startedAt, run.completedAt, nowMs)
}

export function isTerminalStatus(status: WorkflowRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "approved" || status === "rejected"
}

export function isLiveActivity(activity: WorkflowActivityState): boolean {
  return activity === "active" || activity === "stale"
}

function matchesFilter(run: WorkflowRunRecord, filter: RunFilter): boolean {
  if (filter === "all") {
    return true
  }
  if (filter === "active") {
    return run.activityState === "active"
  }
  if (filter === "stale") {
    return run.activityState === "stale"
  }
  if (filter === "failed") {
    return run.status === "failed" || run.status === "rejected"
  }
  return run.activityState === "terminal"
}

function compareRuns(left: WorkflowRunRecord, right: WorkflowRunRecord, sort: RunSort): number {
  if (sort === "name") {
    return left.id.localeCompare(right.id)
  }
  if (sort === "duration") {
    return timestampDuration(right) - timestampDuration(left)
  }
  const leftValue = parseTimestamp(sort === "started" ? left.startedAt : left.heartbeatAt ?? left.updatedAt) ?? 0
  const rightValue = parseTimestamp(sort === "started" ? right.startedAt : right.heartbeatAt ?? right.updatedAt) ?? 0
  if (leftValue !== rightValue) {
    return rightValue - leftValue
  }
  return left.id.localeCompare(right.id)
}

function timestampDuration(run: WorkflowRunRecord): number {
  const startedAt = parseTimestamp(run.startedAt)
  if (startedAt === null) {
    return -1
  }
  const completedAt = parseTimestamp(run.completedAt) ?? Date.now()
  return Math.max(0, completedAt - startedAt)
}

function elapsedMs(startValue: string | null | undefined, endValue: string | null | undefined, nowMs: number): number | null {
  const startedAt = parseTimestamp(startValue)
  if (startedAt === null) {
    return null
  }
  const completedAt = parseTimestamp(endValue)
  return Math.max(0, (completedAt ?? nowMs) - startedAt)
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp
}
