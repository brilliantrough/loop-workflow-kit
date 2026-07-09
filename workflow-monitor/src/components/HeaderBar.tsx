import type { WorkflowRunRecord } from "@/lib/types"
import type { WorkflowMonitorSnapshot, WorkflowStreamState } from "@/lib/types"

type HeaderBarProps = {
  readonly onBack: () => void
  readonly run: WorkflowRunRecord | null
  readonly snapshot: WorkflowMonitorSnapshot | null
  readonly streamState: WorkflowStreamState
}

export function HeaderBar({ onBack, run, snapshot, streamState }: HeaderBarProps) {
  const workflowName = snapshot?.workflow.name ?? "Waiting for workflow"
  const runId = run?.id ?? "unknown-run"
  const workflowStatus = snapshot?.workflow.status ?? "loading"
  const currentNode = snapshot?.execution.currentNodeId ?? "idle"
  const streamLabel = `${run?.activityState ?? "unknown"} / ${formatStreamState(streamState)}`
  const operatorDir = run?.operatorDir ?? "unknown"
  const runDirectory = snapshot?.workflow.runDirectory ?? "unknown"
  const backend = run?.backend ?? "unknown"
  const updatedAt = formatTimestamp(run?.updatedAt ?? snapshot?.workflow.updatedAt ?? null)
  return (
    <header className="header-bar">
      <div>
        <button className="header-bar__back" onClick={onBack} type="button">
          All Runs
        </button>
        <div className="header-bar__eyebrow">Workflow Monitor</div>
        <h1 title={workflowName}>{workflowName}</h1>
        <div className="header-bar__slug" title={runId}>{runId}</div>
      </div>
      <div className="header-bar__stats">
        <div className="header-stat">
          <span>Status</span>
          <strong title={workflowStatus}>{workflowStatus}</strong>
        </div>
        <div className="header-stat">
          <span>Current Node</span>
          <strong title={currentNode}>{currentNode}</strong>
        </div>
        <div className="header-stat">
          <span>Runner / Stream</span>
          <strong title={streamLabel}>{streamLabel}</strong>
        </div>
      </div>
      <div className="header-bar__run-dir">
        <span>Operator</span>
        <code title={operatorDir}>{operatorDir}</code>
      </div>
      <div className="header-bar__run-dir">
        <span>Run Directory</span>
        <code title={runDirectory}>{runDirectory}</code>
      </div>
      <div className="header-bar__run-dir">
        <span>Backend</span>
        <code title={backend}>{backend}</code>
      </div>
      <div className="header-bar__run-dir">
        <span>Updated</span>
        <code title={updatedAt}>{updatedAt}</code>
      </div>
    </header>
  )
}

function formatStreamState(value: WorkflowStreamState): string {
  if (value === "connected") {
    return "connected"
  }
  if (value === "reconnecting") {
    return "reconnecting"
  }
  return "connecting"
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "n/a"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}
