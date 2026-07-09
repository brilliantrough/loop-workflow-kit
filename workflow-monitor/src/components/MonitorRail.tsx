import type { WorkflowMonitorSnapshot, WorkflowMonitorStatus, WorkflowRunRecord, WorkflowStreamState } from "@/lib/types"
import { formatDuration, formatRelativeTime, nodeDurationMs, runDurationMs } from "@/lib/monitor"

type MonitorRailProps = {
  readonly onSelectNode: (nodeId: string) => void
  readonly nowMs: number
  readonly run: WorkflowRunRecord | null
  readonly selectedNodeId: string | null
  readonly snapshot: WorkflowMonitorSnapshot | null
  readonly streamState: WorkflowStreamState
}

type NodeStatusCounts = Record<WorkflowMonitorStatus, number>

const EMPTY_STATUS_COUNTS: NodeStatusCounts = {
  approved: 0,
  completed: 0,
  failed: 0,
  idle: 0,
  pending: 0,
  ready: 0,
  rejected: 0,
  running: 0,
}

export function MonitorRail({ nowMs, onSelectNode, run, selectedNodeId, snapshot, streamState }: MonitorRailProps) {
  if (!snapshot) {
    return (
      <aside className="monitor-rail">
        <div className="monitor-rail__empty">Waiting for snapshot.</div>
      </aside>
    )
  }

  const currentNodeId = snapshot.execution.currentNodeId ?? null
  const counts = countNodeStatuses(snapshot)

  return (
    <aside className="monitor-rail">
      <section className="monitor-rail__section monitor-rail__section--context">
        <div className="monitor-rail__eyebrow">Run Context</div>
        <h2>{run?.id ?? "unknown-run"}</h2>
        <div className="monitor-rail__status-line">
          <span className={`status-dot status-dot--${snapshot.workflow.status}`} />
          <strong>{snapshot.workflow.status}</strong>
          <span>{run?.activityState ?? "unknown"} / {formatStreamState(streamState)}</span>
        </div>
        <div className="monitor-rail__meta-grid">
          <RailMeta label="backend" value={run?.backend ?? "unknown"} />
          <RailMeta label="nodes" value={String(snapshot.graph.nodes.length)} />
          <RailMeta label="current" value={currentNodeId ?? "idle"} />
          <RailMeta label="duration" value={run ? formatDuration(runDurationMs(run, nowMs)) : "n/a"} />
          <RailMeta label="activity" value={run ? formatRelativeTime(run.heartbeatAt ?? run.updatedAt, nowMs) : "n/a"} />
        </div>
      </section>

      <section className="monitor-rail__section">
        <div className="monitor-rail__section-title">Node Outline</div>
        <div className="monitor-rail__status-summary">
          <StatusCount label="run" tone="running" value={counts.running + counts.ready + counts.pending} />
          <StatusCount label="done" tone="completed" value={counts.completed + counts.approved} />
          <StatusCount label="fail" tone="failed" value={counts.failed + counts.rejected} />
        </div>
        <div className="monitor-rail__node-list">
          {snapshot.graph.nodes.map((node) => {
            const state = snapshot.nodeStates[node.id]
            return (
              <button
                className={`monitor-rail__node ${node.id === selectedNodeId ? "is-selected" : ""} ${node.id === currentNodeId ? "is-current" : ""}`}
                key={node.id}
                onClick={() => onSelectNode(node.id)}
                type="button"
              >
                <span className={`status-dot status-dot--${state.status}`} />
                <span className="monitor-rail__node-text">
                  <strong>{node.label}</strong>
                  <span>
                    {node.kind.replaceAll("_", " ")} / {formatDuration(nodeDurationMs(state, nowMs))}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </aside>
  )
}

function RailMeta(input: { readonly label: string; readonly value: string }) {
  return (
    <div className="monitor-rail__meta">
      <span>{input.label}</span>
      <strong>{input.value}</strong>
    </div>
  )
}

function StatusCount(input: { readonly label: string; readonly tone: WorkflowMonitorStatus; readonly value: number }) {
  return (
    <div className="monitor-rail__status-count">
      <span className={`status-dot status-dot--${input.tone}`} />
      <span>{input.label}</span>
      <strong>{input.value}</strong>
    </div>
  )
}

function countNodeStatuses(snapshot: WorkflowMonitorSnapshot): NodeStatusCounts {
  const counts: NodeStatusCounts = { ...EMPTY_STATUS_COUNTS }
  for (const state of Object.values(snapshot.nodeStates)) {
    counts[state.status] += 1
  }
  return counts
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
