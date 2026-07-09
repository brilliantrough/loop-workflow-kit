import type { Edge, Node } from "@xyflow/react"
import { MarkerType } from "@xyflow/react"

import type { WorkflowGraphEdge, WorkflowGraphNode, WorkflowMonitorSnapshot, WorkflowNodeState } from "./types"
import { formatDuration, nodeDurationMs } from "./monitor"

export type WorkflowNodeData = {
  readonly definition: WorkflowGraphNode
  readonly lane: "mainline" | "repair" | "replan" | "aux"
  readonly selected: boolean
  readonly state: WorkflowNodeState
  readonly durationLabel: string
}

type WorkflowNodeLayout = {
  readonly column: number
  readonly lane: number
  readonly laneName: "mainline" | "repair" | "replan" | "aux"
  readonly row: number
  readonly x: number
  readonly y: number
}

const COLUMN_GAP = 300
const FEEDBACK_LANE_Y = 230
const FALLBACK_LANE_Y = 430
const STACK_GAP = 172

export function buildFlowNodes(input: {
  readonly nowMs: number
  readonly selectedNodeId: string | null
  readonly snapshot: WorkflowMonitorSnapshot
}): Node[] {
  const layout = computeNodeLayout(input.snapshot)
  return input.snapshot.graph.nodes.map((definition) => ({
    id: definition.id,
    data: {
      definition,
      durationLabel: formatDuration(nodeDurationMs(input.snapshot.nodeStates[definition.id], input.nowMs)),
      lane: (layout.get(definition.id)?.laneName ?? "aux"),
      selected: definition.id === input.selectedNodeId,
      state: input.snapshot.nodeStates[definition.id],
    },
    draggable: false,
    position: positionFor(definition.id, layout),
    type: "workflowNode",
  }))
}

export function buildFlowEdges(snapshot: WorkflowMonitorSnapshot): Edge[] {
  const layout = computeNodeLayout(snapshot)
  return snapshot.graph.edges.map((edge) => {
    const routing = edgeRouting(edge, layout)
    const executionState = edgeExecutionState(edge, snapshot)
    return {
      animated: executionState === "active",
      className: `workflow-edge workflow-edge--${executionState}`,
      id: edge.id,
      label: edge.label,
      labelBgBorderRadius: 999,
      labelBgPadding: [10, 4],
      labelBgStyle: {
        fill: edgeBadgeColor(edge.route),
        opacity: executionState === "available" ? 0.38 : 0.95,
      },
      labelShowBg: true,
      labelStyle: {
        fill: "#14202d",
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeColor(edge.route),
      },
      pathOptions: {
        borderRadius: 18,
        offset: edge.route === "fail" ? 26 : 20,
      },
      source: edge.source,
      sourceHandle: routing.sourceHandle,
      style: {
        opacity: executionState === "active" ? 1 : executionState === "taken" ? 0.86 : 0.24,
        stroke: edgeColor(edge.route),
        strokeDasharray: edge.route === "fail" ? "7 6" : undefined,
        strokeWidth: executionState === "active" ? 3.2 : executionState === "taken" ? 2.5 : 1.5,
      },
      target: edge.target,
      targetHandle: routing.targetHandle,
      type: routing.type,
      zIndex: edge.route === "fail" ? 0 : 1,
    }
  })
}

function computeNodeLayout(snapshot: WorkflowMonitorSnapshot): Map<string, WorkflowNodeLayout> {
  const edgesBySource = new Map<string, WorkflowGraphEdge[]>()
  const edgesByTarget = new Map<string, WorkflowGraphEdge[]>()
  for (const edge of snapshot.graph.edges) {
    const outgoing = edgesBySource.get(edge.source) ?? []
    outgoing.push(edge)
    edgesBySource.set(edge.source, outgoing)
    const incoming = edgesByTarget.get(edge.target) ?? []
    incoming.push(edge)
    edgesByTarget.set(edge.target, incoming)
  }

  const layout = new Map<string, WorkflowNodeLayout>()
  for (const node of snapshot.graph.nodes) {
    if (!node.layout || !Number.isFinite(node.layout.x) || !Number.isFinite(node.layout.y)) {
      continue
    }
    const laneName = node.layout.lane ?? "aux"
    layout.set(node.id, {
      column: Math.round(node.layout.x / COLUMN_GAP),
      lane: laneNumber(laneName),
      laneName,
      row: 0,
      x: node.layout.x,
      y: node.layout.y,
    })
  }
  const mainline = buildMainline(snapshot.workflow.entryNodeId, edgesBySource)
  const mainlineColumns = new Map<string, number>()
  for (const [column, nodeId] of mainline.entries()) {
    mainlineColumns.set(nodeId, layout.get(nodeId)?.column ?? column)
    if (layout.has(nodeId)) {
      continue
    }
    layout.set(nodeId, {
      column,
      lane: 0,
      laneName: "mainline",
      row: 0,
      x: column * COLUMN_GAP,
      y: 0,
    })
  }

  const stackSlots = new Map<string, number>()
  let fallbackColumn = mainline.length
  for (const node of snapshot.graph.nodes) {
    if (layout.has(node.id)) {
      continue
    }

    const incoming = edgesByTarget.get(node.id) ?? []
    const outgoing = edgesBySource.get(node.id) ?? []
    const failSource = incoming.find((edge) => edge.route === "fail" && mainlineColumns.has(edge.source))
    const successTarget = outgoing.find((edge) => edge.route !== "fail" && mainlineColumns.has(edge.target))
    const lane = laneForNode(node, incoming, outgoing, mainlineColumns)

    let column = failSource ? mainlineColumns.get(failSource.source) : undefined
    if (column === undefined && successTarget) {
      column = mainlineColumns.get(successTarget.target)
    }
    if (column === undefined) {
      column = fallbackColumn
      fallbackColumn += 1
    }

    const row = takeStackSlot(stackSlots, lane, column)
    layout.set(node.id, {
      column,
      lane,
      laneName: laneName(lane),
      row,
      x: column * COLUMN_GAP,
      y: laneBaseY(lane) + row * STACK_GAP,
    })
  }

  return layout
}

function buildMainline(entryNodeId: string, edgesBySource: Map<string, WorkflowGraphEdge[]>): string[] {
  const ordered: string[] = []
  const visited = new Set<string>()
  let current: string | null = entryNodeId

  while (current !== null && !visited.has(current)) {
    visited.add(current)
    ordered.push(current)
    current = pickMainlineTarget(current, edgesBySource, visited)
  }

  return ordered
}

function pickMainlineTarget(
  nodeId: string,
  edgesBySource: Map<string, WorkflowGraphEdge[]>,
  visited: Set<string>,
): string | null {
  const outgoing = [...(edgesBySource.get(nodeId) ?? [])].sort((left, right) => routePriority(left.route) - routePriority(right.route))
  for (const edge of outgoing) {
    if (edge.route === "fail" || visited.has(edge.target)) {
      continue
    }
    return edge.target
  }
  return null
}

function routePriority(route: WorkflowGraphEdge["route"]): number {
  if (route === "next") {
    return 0
  }
  if (route === "pass") {
    return 1
  }
  return 2
}

function isFeedbackNode(node: WorkflowGraphNode, incoming: readonly WorkflowGraphEdge[]): boolean {
  return node.kind.includes("feedback") || incoming.some((edge) => edge.route === "fail")
}

function laneForNode(
  node: WorkflowGraphNode,
  incoming: readonly WorkflowGraphEdge[],
  outgoing: readonly WorkflowGraphEdge[],
  mainlineColumns: ReadonlyMap<string, number>,
): number {
  if (!isFeedbackNode(node, incoming)) {
    return 3
  }
  const failSource = incoming.find((edge) => edge.route === "fail" && mainlineColumns.has(edge.source))
  const successTarget = outgoing.find((edge) => edge.route !== "fail" && mainlineColumns.has(edge.target))
  if (!failSource || !successTarget) {
    return 1
  }
  const fromColumn = mainlineColumns.get(failSource.source) ?? 0
  const toColumn = mainlineColumns.get(successTarget.target) ?? fromColumn
  return fromColumn - toColumn >= 3 ? 2 : 1
}

function takeStackSlot(stackSlots: Map<string, number>, lane: number, column: number): number {
  const slotKey = `${lane}:${column}`
  const next = stackSlots.get(slotKey) ?? 0
  stackSlots.set(slotKey, next + 1)
  return next
}

function laneBaseY(lane: number): number {
  if (lane === 0) {
    return 0
  }
  if (lane === 1) {
    return FEEDBACK_LANE_Y
  }
  return FALLBACK_LANE_Y + (lane - 2) * STACK_GAP
}

function laneName(lane: number): "mainline" | "repair" | "replan" | "aux" {
  if (lane === 0) {
    return "mainline"
  }
  if (lane === 1) {
    return "repair"
  }
  if (lane === 2) {
    return "replan"
  }
  return "aux"
}

function laneNumber(lane: WorkflowNodeLayout["laneName"]): number {
  if (lane === "mainline") {
    return 0
  }
  if (lane === "repair") {
    return 1
  }
  if (lane === "replan") {
    return 2
  }
  return 3
}

function positionFor(nodeId: string, layout: Map<string, WorkflowNodeLayout>): { x: number; y: number } {
  const nodeLayout = layout.get(nodeId)
  if (!nodeLayout) {
    return { x: 0, y: 0 }
  }
  return { x: nodeLayout.x, y: nodeLayout.y }
}

function edgeRouting(
  edge: WorkflowGraphEdge,
  layout: Map<string, WorkflowNodeLayout>,
): {
  readonly sourceHandle: string
  readonly targetHandle: string
  readonly type: "smoothstep" | "step"
} {
  const source = layout.get(edge.source)
  const target = layout.get(edge.target)
  if (!source || !target) {
    return {
      sourceHandle: "out-right",
      targetHandle: "in-left",
      type: edge.route === "fail" ? "smoothstep" : "step",
    }
  }

  if (source.lane === 0 && target.lane === 0) {
    return {
      sourceHandle: source.column <= target.column ? "out-right" : "out-left",
      targetHandle: source.column <= target.column ? "in-left" : "in-right",
      type: "step",
    }
  }

  if (source.lane === 0 && target.lane > 0) {
    return {
      sourceHandle: "out-bottom",
      targetHandle: "in-top",
      type: edge.route === "fail" ? "step" : "smoothstep",
    }
  }

  if (source.lane > 0 && target.lane === 0) {
    if (source.column === target.column) {
      return {
        sourceHandle: "out-top",
        targetHandle: "in-bottom",
        type: "step",
      }
    }
    return {
      sourceHandle: source.column > target.column ? "out-left" : "out-right",
      targetHandle: "in-bottom",
      type: "step",
    }
  }

  return {
    sourceHandle: source.column <= target.column ? "out-right" : "out-left",
    targetHandle: source.column <= target.column ? "in-left" : "in-right",
    type: "smoothstep",
  }
}

function edgeExecutionState(
  edge: WorkflowGraphEdge,
  snapshot: WorkflowMonitorSnapshot,
): "active" | "taken" | "available" {
  const current = snapshot.execution.currentNodeId
  if (current !== null && current !== undefined && (edge.source === current || edge.target === current)) {
    return "active"
  }
  const sourceState = snapshot.nodeStates[edge.source]
  const targetState = snapshot.nodeStates[edge.target]
  if (!sourceState || !targetState) {
    return "available"
  }
  if ((edge.route === "pass" || edge.route === "fail") && sourceState.routeOutcome === edge.route) {
    return "taken"
  }
  if (
    edge.route === "next" &&
    isNodeTerminal(sourceState.status) &&
    typeof targetState.startedAt === "string" &&
    timestampAtOrAfter(targetState.startedAt, sourceState.completedAt)
  ) {
    return "taken"
  }
  return "available"
}

function isNodeTerminal(status: WorkflowNodeState["status"]): boolean {
  return status === "completed" || status === "approved" || status === "failed" || status === "rejected"
}

function timestampAtOrAfter(value: string, baseline: string | null | undefined): boolean {
  if (!baseline) {
    return true
  }
  const valueTime = Date.parse(value)
  const baselineTime = Date.parse(baseline)
  return !Number.isNaN(valueTime) && !Number.isNaN(baselineTime) && valueTime >= baselineTime
}

function edgeColor(route: "next" | "pass" | "fail"): string {
  if (route === "pass") {
    return "#3f7d64"
  }
  if (route === "fail") {
    return "#b45454"
  }
  return "#58708b"
}

function edgeBadgeColor(route: "next" | "pass" | "fail"): string {
  if (route === "pass") {
    return "rgba(171, 217, 194, 0.94)"
  }
  if (route === "fail") {
    return "rgba(235, 198, 198, 0.96)"
  }
  return "rgba(204, 216, 228, 0.96)"
}
