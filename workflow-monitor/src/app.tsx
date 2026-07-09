import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react"
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  type NodeTypes,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
} from "@xyflow/react"
import { ArrowRight, LocateFixed, Maximize2, Search } from "lucide-react"

import { HeaderBar } from "@/components/HeaderBar"
import { MonitorRail } from "@/components/MonitorRail"
import { SidePanel } from "@/components/SidePanel"
import { WorkflowNode } from "@/components/WorkflowNode"
import { useWorkflowMonitor } from "@/hooks/useWorkflowMonitor"
import { useWorkflowRuns } from "@/hooks/useWorkflowRuns"
import { buildFlowEdges, buildFlowNodes } from "@/lib/graph"
import {
  filterAndSortRuns,
  formatDuration,
  formatRelativeTime,
  isLiveActivity,
  isTerminalStatus,
  runDurationMs,
  type RunFilter,
  type RunSort,
} from "@/lib/monitor"
import type { WorkflowMonitorSnapshot, WorkflowRunRecord, WorkflowStreamState } from "@/lib/types"

const nodeTypes: NodeTypes = {
  workflowNode: WorkflowNode,
}

export function App() {
  const {
    defaultRunId,
    error: runsError,
    runs,
    runsRoot,
    streamState: runsStreamState,
  } = useWorkflowRuns()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => readSelectedRunId())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => readSelectedNodeId())
  const deferredSelectedNodeId = useDeferredValue(selectedNodeId)
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  )
  const monitor = useWorkflowMonitor(selectedRunId)

  useEffect(() => {
    const onPopState = () => {
      startTransition(() => {
        setSelectedRunId(readSelectedRunId())
        setSelectedNodeId(readSelectedNodeId())
      })
    }
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("popstate", onPopState)
    }
  }, [])

  useEffect(() => {
    if (!monitor.snapshot) {
      return
    }
    if (monitor.snapshot.execution.currentNodeId && selectedNodeId === null) {
      setSelectedNodeId(monitor.snapshot.execution.currentNodeId)
      return
    }
    if (selectedNodeId && monitor.snapshot.graph.nodes.some((node) => node.id === selectedNodeId)) {
      return
    }
    setSelectedNodeId(monitor.snapshot.graph.nodes[0]?.id ?? null)
  }, [monitor.snapshot, selectedNodeId])

  const runStats = useMemo(() => summarizeRuns(runs), [runs])

  const openRun = (runId: string) => {
    writeSelectedRunId(runId)
    startTransition(() => {
      setSelectedRunId(runId)
      setSelectedNodeId(null)
    })
  }

  const closeRun = () => {
    clearSelectedRunId()
    startTransition(() => {
      setSelectedRunId(null)
      setSelectedNodeId(null)
    })
  }

  const selectNode = (nodeId: string | null) => {
    writeSelectedNodeId(nodeId)
    setSelectedNodeId(nodeId)
  }

  if (selectedRunId === null) {
    return (
      <RunChooser
        streamState={runsStreamState}
        defaultRunId={defaultRunId}
        error={runsError}
        onOpenRun={openRun}
        runs={runs}
        runsRoot={runsRoot}
        stats={runStats}
      />
    )
  }

  return (
    <MonitorDetail
      streamState={monitor.streamState}
      error={monitor.error ?? runsError}
      onBack={closeRun}
      onSelectNode={selectNode}
      run={selectedRun}
      selectedNodeId={deferredSelectedNodeId}
      snapshot={monitor.snapshot}
    />
  )
}

function MonitorDetail(input: {
  readonly error: string | null
  readonly onBack: () => void
  readonly onSelectNode: (nodeId: string | null) => void
  readonly run: WorkflowRunRecord | null
  readonly selectedNodeId: string | null
  readonly snapshot: WorkflowMonitorSnapshot | null
  readonly streamState: WorkflowStreamState
}) {
  const nowMs = useNow()
  const [followCurrent, setFollowCurrent] = useState(() => input.run?.activityState === "active")
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const currentNodeId = input.snapshot?.execution.currentNodeId ?? null
  const nodes = input.snapshot
    ? buildFlowNodes({ nowMs, selectedNodeId: input.selectedNodeId, snapshot: input.snapshot })
    : []
  const edges = input.snapshot ? buildFlowEdges(input.snapshot) : []
  const graphSummary = input.snapshot ? summarizeGraph(input.snapshot) : null

  useEffect(() => {
    if (!followCurrent || !currentNodeId) {
      return
    }
    input.onSelectNode(currentNodeId)
    if (!flowInstance) {
      return
    }
    const timer = window.setTimeout(() => {
      const node = flowInstance.getNode(currentNodeId)
      if (node) {
        void flowInstance.fitView({ duration: 360, maxZoom: 0.82, nodes: [node], padding: 2.2 })
      }
    }, 40)
    return () => window.clearTimeout(timer)
  }, [currentNodeId, flowInstance, followCurrent])

  const selectNode = (nodeId: string) => {
    setFollowCurrent(false)
    input.onSelectNode(nodeId)
    const node = flowInstance?.getNode(nodeId)
    if (node && flowInstance) {
      void flowInstance.fitView({ duration: 280, maxZoom: 0.82, nodes: [node], padding: 2.2 })
    }
  }

  const enableFollow = () => {
    const next = !followCurrent
    setFollowCurrent(next)
    if (next && currentNodeId) {
      input.onSelectNode(currentNodeId)
    }
  }

  return (
    <div className="monitor-shell">
      <div className="monitor-shell__background" />
      <HeaderBar onBack={input.onBack} run={input.run} snapshot={input.snapshot} streamState={input.streamState} />
      {input.error ? <div className="monitor-error">{input.error}</div> : null}
      <div className="monitor-layout">
        <MonitorRail
          nowMs={nowMs}
          onSelectNode={selectNode}
          run={input.run}
          selectedNodeId={input.selectedNodeId}
          snapshot={input.snapshot}
          streamState={input.streamState}
        />
        <main className="graph-stage">
          <div className="graph-stage__toolbar">
            <button aria-pressed={followCurrent} className={followCurrent ? "is-active" : ""} onClick={enableFollow} type="button">
              <LocateFixed aria-hidden="true" size={14} />
              Follow current
            </button>
            <button onClick={() => void flowInstance?.fitView({ duration: 300, padding: 0.16 })} type="button">
              <Maximize2 aria-hidden="true" size={14} />
              Fit graph
            </button>
          </div>
          <div className="graph-stage__legend">
            <StatusSwatch label="idle" tone="idle" />
            <StatusSwatch label="ready" tone="ready" />
            <StatusSwatch label="running" tone="running" />
            <StatusSwatch label="completed" tone="completed" />
            <StatusSwatch label="failed" tone="failed" />
            <StatusSwatch label="approved" tone="approved" />
            <StatusSwatch label="pending" tone="pending" />
            <StatusSwatch label="rejected" tone="rejected" />
          </div>
          {input.snapshot ? (
            <ReactFlowProvider>
              <ReactFlow
                edges={edges}
                fitView
                fitViewOptions={{ padding: 0.16 }}
                nodeTypes={nodeTypes}
                nodes={nodes}
                nodesConnectable={false}
                onInit={setFlowInstance}
                onNodeClick={(_, node) => selectNode(node.id)}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#d4cfbf" gap={20} size={1.2} />
                <Controls position="bottom-left" />
                <MiniMap
                  className="graph-stage__minimap"
                  maskColor="rgba(245, 241, 232, 0.82)"
                  pannable
                  zoomable
                />
                {graphSummary ? (
                  <Panel position="top-right">
                    <div className="graph-stage__guide">
                      <div className="graph-stage__guide-title">Flow Layout</div>
                      <div className="graph-stage__guide-grid">
                        <GuideChip tone="mainline" label={`mainline ${graphSummary.mainline}`} />
                        <GuideChip tone="repair" label={`repair loops ${graphSummary.repair}`} />
                        <GuideChip tone="replan" label={`replan loops ${graphSummary.replan}`} />
                      </div>
                    </div>
                  </Panel>
                ) : null}
              </ReactFlow>
            </ReactFlowProvider>
          ) : (
            <div className="graph-stage__empty">
              <h2>Loading Run Snapshot</h2>
              <p>Waiting for workflow monitor files for this run.</p>
            </div>
          )}
        </main>
        <SidePanel nowMs={nowMs} selectedNodeId={input.selectedNodeId} snapshot={input.snapshot} />
      </div>
    </div>
  )
}

function RunChooser(input: {
  readonly defaultRunId: string | null
  readonly error: string | null
  readonly onOpenRun: (runId: string) => void
  readonly runs: readonly WorkflowRunRecord[]
  readonly runsRoot: string | null
  readonly stats: RunStats
  readonly streamState: WorkflowStreamState
}) {
  const nowMs = useNow(10_000)
  const [filter, setFilter] = useState<RunFilter>("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<RunSort>("updated")
  const deferredQuery = useDeferredValue(query)
  const visibleRuns = useMemo(
    () => filterAndSortRuns(input.runs, { filter, query: deferredQuery, sort }),
    [deferredQuery, filter, input.runs, sort],
  )

  return (
    <div className="monitor-shell">
      <div className="monitor-shell__background" />
      <section className="run-library">
        <header className="run-library__header">
          <div>
            <div className="header-bar__eyebrow">Workflow Monitor</div>
            <h1>Run Library</h1>
            <code title={input.runsRoot ?? undefined}>{input.runsRoot ?? "discovering runs root..."}</code>
          </div>
          <div className="run-library__stats">
            <LibraryStat label="catalog stream" value={formatStreamState(input.streamState)} />
            <LibraryStat label="total runs" value={String(input.stats.total)} />
            <LibraryStat label="live runs" value={String(input.stats.live)} />
            <LibraryStat label="stale" value={String(input.stats.stale)} />
          </div>
        </header>
        {input.error ? <div className="monitor-error">{input.error}</div> : null}
        <div className="run-library__controls">
          <label className="run-search">
            <Search aria-hidden="true" size={16} />
            <span className="sr-only">Search workflow runs</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search run, workflow, operator, backend, node..."
              type="search"
              value={query}
            />
          </label>
          <div aria-label="Run status filter" className="run-filter" role="group">
            {(["all", "active", "stale", "failed", "finished"] as const).map((value) => (
              <button
                aria-pressed={filter === value}
                className={filter === value ? "is-active" : ""}
                key={value}
                onClick={() => setFilter(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
          <label className="run-sort">
            <span>Sort</span>
            <select onChange={(event) => setSort(event.target.value as RunSort)} value={sort}>
              <option value="updated">Last activity</option>
              <option value="started">Start time</option>
              <option value="duration">Duration</option>
              <option value="name">Run name</option>
            </select>
          </label>
        </div>
        <div className="run-list">
          <div aria-hidden="true" className="run-list__head">
            <span>Run</span>
            <span>Status</span>
            <span>Current node</span>
            <span>Timing</span>
            <span>Context</span>
            <span />
          </div>
          {visibleRuns.map((run) => (
            <button
              className={`run-row ${run.id === input.defaultRunId ? "is-default" : ""}`}
              key={run.id}
              onClick={() => input.onOpenRun(run.id)}
              type="button"
            >
              <div className="run-row__identity">
                <strong title={run.id}>{run.id}</strong>
                <span>{run.workflowName ?? "workflow"}</span>
                {run.id === input.defaultRunId ? <small>current</small> : null}
              </div>
              <div className="run-row__status">
                <span className={`run-status run-status--${run.status}`}>{run.status}</span>
                <span className={`activity-state activity-state--${run.activityState}`}>{run.activityState}</span>
              </div>
              <div className="run-row__node">
                <strong>{run.currentNodeId ?? "idle"}</strong>
                <span>{isLiveActivity(run.activityState) ? "in progress" : "last stage"}</span>
              </div>
              <div className="run-row__timing">
                <strong>{formatDuration(runDurationMs(run, nowMs))}</strong>
                <span>{formatRelativeTime(run.heartbeatAt ?? run.updatedAt, nowMs)}</span>
              </div>
              <div className="run-row__context">
                <strong>{run.backend ?? "unknown backend"}</strong>
                <span title={run.subject ?? run.operatorDir ?? undefined}>{run.subject ?? run.operatorDir ?? "no subject metadata"}</span>
                {!run.hasSnapshot ? <small>snapshot missing</small> : null}
              </div>
              <ArrowRight aria-hidden="true" className="run-row__arrow" size={17} />
            </button>
          ))}
        </div>
        {input.runs.length === 0 ? (
          <div className="run-library__empty">
            <h2>No workflow runs yet</h2>
            <p>Start a workflow first, or point the monitor server at another runs root with `--runs-root`.</p>
          </div>
        ) : visibleRuns.length === 0 ? (
          <div className="run-library__empty run-library__empty--filtered">
            <h2>No matching runs</h2>
            <p>Change the search text or status filter.</p>
          </div>
        ) : null}
      </section>
    </div>
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

function LibraryStat(input: { readonly label: string; readonly value: string }) {
  return (
    <div className="library-stat">
      <span>{input.label}</span>
      <strong>{input.value}</strong>
    </div>
  )
}

function StatusSwatch(input: { readonly label: string; readonly tone: string }) {
  return (
    <div className="status-swatch">
      <span className={`status-swatch__dot status-swatch__dot--${input.tone}`} />
      <span>{input.label}</span>
    </div>
  )
}

function GuideChip(input: { readonly label: string; readonly tone: "mainline" | "repair" | "replan" }) {
  return <div className={`guide-chip guide-chip--${input.tone}`}>{input.label}</div>
}

function summarizeGraph(snapshot: WorkflowMonitorSnapshot) {
  const byId = new Map(snapshot.graph.nodes.map((node) => [node.id, node]))
  let mainline = 0
  let repair = 0
  let replan = 0
  for (const node of snapshot.graph.nodes) {
    if (!node.kind.includes("feedback")) {
      mainline += 1
      continue
    }
    const incomingFail = snapshot.graph.edges.find((edge) => edge.target === node.id && edge.route === "fail")
    const outgoingSuccess = snapshot.graph.edges.find((edge) => edge.source === node.id && edge.route !== "fail")
    const sourceNode = incomingFail ? byId.get(incomingFail.source) : null
    const targetNode = outgoingSuccess ? byId.get(outgoingSuccess.target) : null
    if (sourceNode?.kind === "gate" && targetNode?.id === sourceNode.id) {
      repair += 1
    } else {
      replan += 1
    }
  }
  return { mainline, repair, replan }
}

type RunStats = {
  readonly live: number
  readonly stale: number
  readonly terminal: number
  readonly total: number
}

function summarizeRuns(runs: readonly WorkflowRunRecord[]): RunStats {
  let live = 0
  let stale = 0
  let terminal = 0
  for (const run of runs) {
    if (run.activityState === "active") {
      live += 1
      continue
    }
    if (run.activityState === "stale") {
      stale += 1
      continue
    }
    if (isTerminalStatus(run.status)) {
      terminal += 1
    }
  }
  return {
    live,
    stale,
    terminal,
    total: runs.length,
  }
}

function readSelectedRunId(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get("run")
}

function writeSelectedRunId(runId: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set("run", runId)
  url.searchParams.delete("node")
  window.history.pushState({}, "", url)
}

function clearSelectedRunId(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete("run")
  url.searchParams.delete("node")
  window.history.pushState({}, "", url)
}

function readSelectedNodeId(): string | null {
  return new URL(window.location.href).searchParams.get("node")
}

function writeSelectedNodeId(nodeId: string | null): void {
  const url = new URL(window.location.href)
  if (nodeId) {
    url.searchParams.set("node", nodeId)
  } else {
    url.searchParams.delete("node")
  }
  window.history.replaceState({}, "", url)
}

function useNow(intervalMs = 1_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return nowMs
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}
