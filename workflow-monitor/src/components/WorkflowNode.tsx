import { Handle, Position, type NodeProps } from "@xyflow/react"

import type { WorkflowNodeData } from "@/lib/graph"

const HIDDEN_HANDLE_STYLE = {
  background: "transparent",
  border: "none",
  height: 10,
  opacity: 0,
  pointerEvents: "none" as const,
  width: 10,
}

export function WorkflowNode({ data }: NodeProps) {
  const typed = data as WorkflowNodeData
  return (
    <div
      className={`workflow-node workflow-node--${typed.definition.kind} workflow-node--${typed.state.status} workflow-node--lane-${typed.lane} ${typed.selected ? "is-selected" : ""}`}
    >
      <Handle id="in-left" position={Position.Left} style={HIDDEN_HANDLE_STYLE} type="target" />
      <Handle id="in-right" position={Position.Right} style={HIDDEN_HANDLE_STYLE} type="target" />
      <Handle id="in-top" position={Position.Top} style={HIDDEN_HANDLE_STYLE} type="target" />
      <Handle id="in-bottom" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} type="target" />
      <div className="workflow-node__eyebrow">
        <span>{typed.definition.kind.replaceAll("_", " ")}</span>
        <span className="workflow-node__status">{typed.state.status}</span>
      </div>
      <div className="workflow-node__title">{typed.definition.label}</div>
      <div className="workflow-node__lane">{laneLabel(typed.lane)}</div>
      <div className="workflow-node__meta">
        {typed.definition.session ? <span>session: {typed.definition.session}</span> : null}
        {typed.definition.agent ? <span>agent: {typed.definition.agent}</span> : null}
        {typed.definition.engine ? <span>engine: {typed.definition.engine}</span> : null}
        <span>attempts: {typed.state.attempts}</span>
        <span>duration: {typed.durationLabel}</span>
      </div>
      {typed.state.detail ? <div className="workflow-node__detail">{typed.state.detail}</div> : null}
      <Handle id="out-right" position={Position.Right} style={HIDDEN_HANDLE_STYLE} type="source" />
      <Handle id="out-left" position={Position.Left} style={HIDDEN_HANDLE_STYLE} type="source" />
      <Handle id="out-top" position={Position.Top} style={HIDDEN_HANDLE_STYLE} type="source" />
      <Handle id="out-bottom" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} type="source" />
    </div>
  )
}

function laneLabel(lane: WorkflowNodeData["lane"]): string {
  if (lane === "mainline") {
    return "mainline"
  }
  if (lane === "repair") {
    return "repair loop"
  }
  if (lane === "replan") {
    return "replan loop"
  }
  return "auxiliary"
}
