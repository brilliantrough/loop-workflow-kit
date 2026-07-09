import { useEffect, useRef, useState } from "react"

import {
  ArtifactPathSection,
  ArtifactPreviewCard,
  CopyableCodeBlock,
  RecentActivitySection,
  type CopyFeedback,
  pathCopyKey,
} from "@/components/ArtifactWidgets"
import { fetchFilePreview, fetchFileStatuses } from "@/lib/api"
import { copyTextToClipboard } from "@/lib/clipboard"
import { formatDuration, formatRelativeTime, nodeDurationMs } from "@/lib/monitor"
import type { WorkflowFilePreview, WorkflowFileStatus, WorkflowMonitorSnapshot } from "@/lib/types"

type SidePanelProps = {
  readonly nowMs: number
  readonly selectedNodeId: string | null
  readonly snapshot: WorkflowMonitorSnapshot | null
}

type InspectorTab = "overview" | "artifacts" | "activity"
type ActivityScope = "node" | "workflow"

export function SidePanel({ nowMs, selectedNodeId, snapshot }: SidePanelProps) {
  const selectedNode = snapshot
    ? snapshot.graph.nodes.find((node) => node.id === selectedNodeId) ??
      snapshot.graph.nodes.find((node) => node.id === snapshot.execution.currentNodeId) ??
      snapshot.graph.nodes[0]
    : null
  const nodeState = selectedNode && snapshot ? snapshot.nodeStates[selectedNode.id] : null
  const relatedEvents = selectedNode && snapshot
    ? snapshot.recentEvents.filter((event) => event.nodeId === selectedNode.id).slice(-20).reverse()
    : []
  const requiredOutputs = selectedNode?.requiredOutputs ?? []
  const primaryArtifacts = (selectedNode
    ? uniquePaths([selectedNode.resultArtifact, selectedNode.selectedArtifactsRecord, selectedNode.decisionArtifact])
    : []).filter((path) => !requiredOutputs.includes(path))
  const eventArtifacts = uniquePaths(relatedEvents.map((event) => event.artifactPath))
    .filter((path) => !requiredOutputs.includes(path) && !primaryArtifacts.includes(path))
  const allArtifactPaths = uniquePaths([...requiredOutputs, ...primaryArtifacts, ...eventArtifacts])
  const artifactPathsKey = allArtifactPaths.join("\n")
  const session = selectedNode?.session && snapshot ? snapshot.sessions[selectedNode.session] : null
  const commandText = selectedNode?.command
    ? formatShellCommand(
        selectedNode.command.map((part) => part.replaceAll("{{runDirectory}}", snapshot?.workflow.runDirectory ?? "{{runDirectory}}")),
      )
    : null

  const previewRequestRef = useRef(0)
  const statusRequestRef = useRef(0)
  const copyResetRef = useRef<number | null>(null)
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview")
  const [activityScope, setActivityScope] = useState<ActivityScope>("node")
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null)
  const [expandedPreview, setExpandedPreview] = useState(false)
  const [fileStatuses, setFileStatuses] = useState<ReadonlyMap<string, WorkflowFileStatus>>(new Map())
  const [preview, setPreview] = useState<WorkflowFilePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [wrapLines, setWrapLines] = useState(true)

  useEffect(() => {
    previewRequestRef.current += 1
    setActivePreviewPath(null)
    setActiveTab("overview")
    setExpandedPreview(false)
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }, [selectedNode?.id])

  useEffect(() => {
    statusRequestRef.current += 1
    const requestId = statusRequestRef.current
    if (allArtifactPaths.length === 0) {
      setFileStatuses(new Map())
      return
    }
    void fetchFileStatuses(allArtifactPaths)
      .then((files) => {
        if (statusRequestRef.current === requestId) {
          setFileStatuses(new Map(files.map((file) => [file.path, file])))
        }
      })
      .catch(() => {
        if (statusRequestRef.current === requestId) {
          setFileStatuses(new Map())
        }
      })
  }, [artifactPathsKey, nodeState?.updatedAt])

  useEffect(() => {
    if (!activePreviewPath) {
      return
    }
    previewRequestRef.current += 1
    const requestId = previewRequestRef.current
    setPreviewLoading(true)
    setPreviewError(null)
    void fetchFilePreview(activePreviewPath)
      .then((next) => {
        if (previewRequestRef.current !== requestId) {
          return
        }
        setPreview(next)
        setPreviewError(null)
      })
      .catch((error) => {
        if (previewRequestRef.current !== requestId) {
          return
        }
        setPreview(null)
        setPreviewError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (previewRequestRef.current === requestId) {
          setPreviewLoading(false)
        }
      })
  }, [activePreviewPath, nodeState?.updatedAt])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpandedPreview(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (!expandedPreview) {
      return
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [expandedPreview])

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current)
      }
    }
  }, [])

  if (!snapshot) {
    return (
      <aside className="side-panel">
        <div className="side-panel__empty">Waiting for workflow monitor snapshot.</div>
      </aside>
    )
  }
  if (!selectedNode || !nodeState) {
    return (
      <aside className="side-panel">
        <div className="side-panel__empty">No workflow nodes found.</div>
      </aside>
    )
  }

  const copyText = (key: string, text: string) => {
    void copyTextToClipboard(text)
      .then(() => setCopyFeedback({ key, status: "copied" }))
      .catch(() => setCopyFeedback({ key, status: "failed" }))
      .finally(() => {
        if (copyResetRef.current !== null) {
          window.clearTimeout(copyResetRef.current)
        }
        copyResetRef.current = window.setTimeout(() => setCopyFeedback(null), 1400)
      })
  }

  const openPreview = (path: string) => {
    setActivePreviewPath(path)
    setActiveTab("artifacts")
  }

  return (
    <aside className="side-panel">
      <div className="side-panel__header">
        <div>
          <span className="side-panel__kind">{selectedNode.kind.replaceAll("_", " ")}</span>
          <h2>{selectedNode.label}</h2>
        </div>
        <span className={`status-chip status-chip--${nodeState.status}`}>{nodeState.status}</span>
      </div>

      <div aria-label="Node inspector views" className="side-panel__tabs" role="tablist">
        {(["overview", "artifacts", "activity"] as const).map((tab) => (
          <button
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "is-active" : ""}
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            type="button"
          >
            {tab}
            {tab === "artifacts" && allArtifactPaths.length > 0 ? <span>{allArtifactPaths.length}</span> : null}
            {tab === "activity" && relatedEvents.length > 0 ? <span>{relatedEvents.length}</span> : null}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <>
          <section className="side-panel__section">
            <div className="detail-row"><span>Node Id</span><code>{selectedNode.id}</code></div>
            <div className="detail-row"><span>Attempts</span><strong>{nodeState.attempts}</strong></div>
            <div className="detail-row"><span>Route</span><strong>{nodeState.routeOutcome ?? "n/a"}</strong></div>
            <div className="detail-row"><span>Duration</span><strong>{formatDuration(nodeDurationMs(nodeState, nowMs))}</strong></div>
            <div className="detail-row"><span>Started</span><strong>{formatTimestamp(nodeState.startedAt)}</strong></div>
            <div className="detail-row"><span>Activity</span><strong>{formatRelativeTime(nodeState.updatedAt, nowMs)}</strong></div>
          </section>

          {selectedNode.session && session ? (
            <section className="side-panel__section">
              <h3>Session</h3>
              <div className="detail-row"><span>Session Name</span><strong>{selectedNode.session}</strong></div>
              <div className="detail-row"><span>Session Id</span><code>{session.id ?? "pending"}</code></div>
              <div className="detail-row"><span>Agent</span><strong>{session.agent}</strong></div>
              <div className="detail-row"><span>Engine</span><strong>{session.engine}</strong></div>
              <div className="detail-row"><span>Prompt Count</span><strong>{session.promptCount}</strong></div>
              {session.attachCommand ? (
                <CopyableCodeBlock
                  feedback={copyFeedback}
                  feedbackKey="attach-command"
                  label="Attach"
                  onCopy={() => copyText("attach-command", session.attachCommand ?? "")}
                  text={session.attachCommand}
                />
              ) : null}
            </section>
          ) : null}

          {commandText ? (
            <section className="side-panel__section">
              <h3>Command</h3>
              <CopyableCodeBlock
                feedback={copyFeedback}
                feedbackKey="node-command"
                label="Shell"
                onCopy={() => copyText("node-command", commandText)}
                text={commandText}
              />
            </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "artifacts" ? (
        <>
          <ArtifactPathSection
            activePath={activePreviewPath}
            feedback={copyFeedback}
            fileStatuses={fileStatuses}
            onCopyPath={(path) => copyText(pathCopyKey(path), path)}
            onPreviewPath={openPreview}
            paths={requiredOutputs}
            title="Required Outputs"
          />
          <ArtifactPathSection
            activePath={activePreviewPath}
            feedback={copyFeedback}
            fileStatuses={fileStatuses}
            onCopyPath={(path) => copyText(pathCopyKey(path), path)}
            onPreviewPath={openPreview}
            paths={primaryArtifacts}
            title="Artifacts"
          />
          <ArtifactPathSection
            activePath={activePreviewPath}
            feedback={copyFeedback}
            fileStatuses={fileStatuses}
            onCopyPath={(path) => copyText(pathCopyKey(path), path)}
            onPreviewPath={openPreview}
            paths={eventArtifacts}
            title="Event Artifacts"
          />
          {activePreviewPath ? (
            <section className="side-panel__section side-panel__section--preview">
              <h3>Quick Preview</h3>
              <ArtifactPreviewCard
                activePreviewPath={activePreviewPath}
                expanded={expandedPreview}
                feedback={copyFeedback}
                onCopyContent={preview?.kind === "text" && preview.content ? () => copyText("preview-content", preview.content ?? "") : null}
                onCopyPath={() => copyText("preview-path", activePreviewPath)}
                onToggleExpanded={() => setExpandedPreview((value) => !value)}
                onToggleWrap={() => setWrapLines((value) => !value)}
                preview={preview}
                previewError={previewError}
                previewLoading={previewLoading}
                wrapLines={wrapLines}
              />
            </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "activity" ? (
        <>
          <div aria-label="Activity scope" className="activity-scope" role="group">
            {(["node", "workflow"] as const).map((scope) => (
              <button
                aria-pressed={activityScope === scope}
                className={activityScope === scope ? "is-active" : ""}
                key={scope}
                onClick={() => setActivityScope(scope)}
                type="button"
              >
                {scope}
              </button>
            ))}
          </div>
          <RecentActivitySection
            events={activityScope === "workflow" ? snapshot.recentEvents.slice(-40).reverse() : relatedEvents}
            nowMs={nowMs}
            onPreviewPath={openPreview}
          />
        </>
      ) : null}
    </aside>
  )
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a"
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function uniquePaths(paths: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) {
      continue
    }
    seen.add(path)
    ordered.push(path)
  }
  return ordered
}

function formatShellCommand(parts: readonly string[]): string {
  return parts.map((part) => {
    if (/^[A-Za-z0-9_./:=+@%,-]+$/.test(part)) {
      return part
    }
    return `'${part.replaceAll("'", `'"'"'`)}'`
  }).join(" ")
}
