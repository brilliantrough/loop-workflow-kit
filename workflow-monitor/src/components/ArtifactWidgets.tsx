import { lazy, Suspense } from "react"
import { createPortal } from "react-dom"
import { Check, Copy, Download, ExternalLink, Maximize2, Minimize2, WrapText, X } from "lucide-react"

import { formatRelativeTime } from "@/lib/monitor"
import type { WorkflowFilePreview, WorkflowFileStatus, WorkflowMonitorSnapshot } from "@/lib/types"

const MarkdownPreview = lazy(() => import("@/components/MarkdownPreview"))

export type CopyFeedback = {
  readonly key: string
  readonly status: "copied" | "failed"
}

type CopyButtonProps = {
  readonly feedback: CopyFeedback | null
  readonly feedbackKey: string
  readonly label: string
  readonly onClick: () => void
}

type ArtifactPathButtonProps = {
  readonly active: boolean
  readonly feedback: CopyFeedback | null
  readonly onCopy: () => void
  readonly onPreview: () => void
  readonly path: string
  readonly status: WorkflowFileStatus | null
}

type ArtifactPreviewCardProps = {
  readonly activePreviewPath: string
  readonly feedback: CopyFeedback | null
  readonly expanded: boolean
  readonly onCopyContent: (() => void) | null
  readonly onCopyPath: () => void
  readonly onToggleExpanded: () => void
  readonly onToggleWrap: () => void
  readonly preview: WorkflowFilePreview | null
  readonly previewError: string | null
  readonly previewLoading: boolean
  readonly wrapLines: boolean
}

type CopyableCodeBlockProps = {
  readonly feedback: CopyFeedback | null
  readonly feedbackKey: string
  readonly label: string
  readonly onCopy: () => void
  readonly text: string
}

type ArtifactPathSectionProps = {
  readonly activePath: string | null
  readonly feedback: CopyFeedback | null
  readonly fileStatuses: ReadonlyMap<string, WorkflowFileStatus>
  readonly onCopyPath: (path: string) => void
  readonly onPreviewPath: (path: string) => void
  readonly paths: readonly string[]
  readonly title: string
}

type RecentActivitySectionProps = {
  readonly events: WorkflowMonitorSnapshot["recentEvents"]
  readonly nowMs: number
  readonly onPreviewPath: (path: string) => void
}

export function CopyButton({ feedback, feedbackKey, label, onClick }: CopyButtonProps) {
  const active = feedback?.key === feedbackKey
  const resolvedLabel = active ? (feedback?.status === "copied" ? "Copied" : "Failed") : label
  return (
    <button
      aria-live="polite"
      className={`copy-button ${active ? `copy-button--${feedback?.status}` : ""}`}
      onClick={onClick}
      title={resolvedLabel}
      type="button"
    >
      {active ? feedback?.status === "copied" ? <Check aria-hidden="true" size={13} /> : <X aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
      <span>{resolvedLabel}</span>
    </button>
  )
}

export function CopyableCodeBlock({ feedback, feedbackKey, label, onCopy, text }: CopyableCodeBlockProps) {
  return (
    <div className="code-block">
      <div className="code-block__bar">
        <div className="code-block__label">{label}</div>
        <CopyButton feedback={feedback} feedbackKey={feedbackKey} label="Copy" onClick={onCopy} />
      </div>
      <code>{text}</code>
    </div>
  )
}

export function ArtifactPathSection({
  activePath,
  feedback,
  fileStatuses,
  onCopyPath,
  onPreviewPath,
  paths,
  title,
}: ArtifactPathSectionProps) {
  if (paths.length === 0) {
    return null
  }
  return (
    <section className="side-panel__section">
      <h3>{title}</h3>
      <div className="path-list">
        {paths.map((path) => (
          <ArtifactPathButton
            active={path === activePath}
            feedback={feedback}
            key={path}
            onCopy={() => onCopyPath(path)}
            onPreview={() => onPreviewPath(path)}
            path={path}
            status={fileStatuses.get(path) ?? null}
          />
        ))}
      </div>
    </section>
  )
}

export function ArtifactPathButton({ active, feedback, onCopy, onPreview, path, status }: ArtifactPathButtonProps) {
  return (
    <div className={`path-button ${active ? "is-active" : ""}`}>
      <button className="path-button__preview" onClick={onPreview} type="button">
        <span className="path-button__title">
          <strong>{pathBasename(path)}</strong>
          <span className={`file-state file-state--${status?.exists ? "present" : "missing"}`}>
            {status ? (status.exists ? "present" : "missing") : "checking"}
          </span>
        </span>
        <code>{path}</code>
      </button>
      <CopyButton feedback={feedback} feedbackKey={pathCopyKey(path)} label="Copy" onClick={onCopy} />
    </div>
  )
}

export function ArtifactPreviewCard({
  activePreviewPath,
  feedback,
  expanded,
  onCopyContent,
  onCopyPath,
  onToggleExpanded,
  onToggleWrap,
  preview,
  previewError,
  previewLoading,
  wrapLines,
}: ArtifactPreviewCardProps) {
  const textContent = preview?.kind === "text" ? formattedPreviewContent(preview) : null
  const isMarkdown = preview?.kind === "text" && preview.language === "markdown"
  const card = (
    <div className={`artifact-preview ${expanded ? "is-expanded" : ""}`}>
      <div className="artifact-preview__header">
        <div className="artifact-preview__titlebar">
          <strong>{pathBasename(preview?.relativePath ?? activePreviewPath)}</strong>
          <div className="artifact-preview__actions">
            <CopyButton feedback={feedback} feedbackKey="preview-path" label="Copy Path" onClick={onCopyPath} />
            {onCopyContent ? (
              <CopyButton feedback={feedback} feedbackKey="preview-content" label="Copy Text" onClick={onCopyContent} />
            ) : null}
            {preview?.kind === "text" ? (
              <button aria-pressed={wrapLines} className="preview-action" onClick={onToggleWrap} title="Toggle line wrapping" type="button">
                <WrapText aria-hidden="true" size={14} />
                <span>Wrap</span>
              </button>
            ) : null}
            {preview?.rawUrl ? (
              <a className="preview-action" href={preview.rawUrl} rel="noreferrer" target="_blank" title="Open raw file">
                <ExternalLink aria-hidden="true" size={14} />
                <span>Open</span>
              </a>
            ) : null}
            {preview?.rawUrl ? (
              <a className="preview-action" href={`${preview.rawUrl}&download=1`} title="Download file">
                <Download aria-hidden="true" size={14} />
                <span>Download</span>
              </a>
            ) : null}
            <button className="preview-action" onClick={onToggleExpanded} title={expanded ? "Exit full screen" : "Open full screen"} type="button">
              {expanded ? <Minimize2 aria-hidden="true" size={14} /> : <Maximize2 aria-hidden="true" size={14} />}
              <span>{expanded ? "Close" : "Expand"}</span>
            </button>
          </div>
        </div>
        <PathHierarchy path={preview?.relativePath ?? activePreviewPath} />
      </div>
      {previewLoading ? <div className="side-panel__empty side-panel__empty--inline">Loading preview…</div> : null}
      {previewError ? <div className="artifact-preview__error">{previewError}</div> : null}
      {preview ? (
        <>
          <div className="artifact-preview__meta">
            <span>{preview.kind}</span>
            <span>{preview.language ?? preview.mediaType ?? "preview"}</span>
            <span>{formatBytes(preview.sizeBytes)}</span>
            <span>{formatTimestamp(preview.modifiedAt)}</span>
            {preview.truncated ? <span>truncated</span> : null}
          </div>
          {preview.kind === "image" && preview.rawUrl ? (
            <img alt={preview.relativePath} className="artifact-preview__image" src={preview.rawUrl} />
          ) : null}
          {isMarkdown && textContent !== null ? (
            <div className="artifact-preview__markdown">
              <Suspense fallback={<div className="side-panel__empty side-panel__empty--inline">Rendering Markdown...</div>}>
                <MarkdownPreview content={textContent} />
              </Suspense>
            </div>
          ) : null}
          {preview.kind === "text" && !isMarkdown ? (
            <pre className={`artifact-preview__content ${wrapLines ? "is-wrapped" : ""}`}>
              <code>{textContent ?? ""}</code>
            </pre>
          ) : null}
          {preview.kind === "binary" ? (
            <div className="side-panel__empty side-panel__empty--inline">Binary file preview is not rendered inline.</div>
          ) : null}
          {preview.kind === "directory" ? (
            <div className="side-panel__empty side-panel__empty--inline">Directory paths cannot be previewed inline.</div>
          ) : null}
        </>
      ) : null}
    </div>
  )
  return expanded ? createPortal(card, document.body) : card
}

export function RecentActivitySection({ events, nowMs, onPreviewPath }: RecentActivitySectionProps) {
  return (
    <section className="side-panel__section">
      <h3>Recent Activity</h3>
      <div className="event-list">
        {events.length > 0 ? (
          events.map((event) => {
            const artifactPath = event.artifactPath ?? null
            return (
              <div className="event-row" key={event.sequence}>
                <div className="event-row__header">
                  <strong>{event.phase}</strong>
                  <time dateTime={event.timestamp}>{formatRelativeTime(event.timestamp, nowMs)}</time>
                </div>
                <code className="event-row__node">{event.nodeId}</code>
                <span>{event.detail ?? event.outcome ?? "event"}</span>
                <div className="event-row__meta">
                  {event.outcome ? <span>outcome: {event.outcome}</span> : null}
                  {event.exitCode !== null && event.exitCode !== undefined ? <span>exit: {event.exitCode}</span> : null}
                  <span>seq: {event.sequence}</span>
                </div>
                {artifactPath ? (
                  <button className="event-row__artifact" onClick={() => onPreviewPath(artifactPath)} type="button">
                    Preview Artifact
                  </button>
                ) : null}
              </div>
            )
          })
        ) : (
          <div className="side-panel__empty side-panel__empty--inline">No events for this node yet.</div>
        )}
      </div>
    </section>
  )
}

function formattedPreviewContent(preview: WorkflowFilePreview): string {
  const content = preview.content ?? ""
  if (preview.language !== "json") {
    return content
  }
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

function PathHierarchy(input: { readonly path: string }) {
  const parts = input.path.split(/[\\/]/).filter((part) => part.length > 0)
  if (parts.length === 0) {
    return <code className="artifact-preview__path">{input.path}</code>
  }
  return (
    <div className="artifact-preview__path" title={input.path}>
      {parts.map((part, index) => (
        <span className={index === parts.length - 1 ? "is-leaf" : ""} key={`${part}-${index}`}>
          {part}
        </span>
      ))}
    </div>
  )
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function pathCopyKey(path: string): string {
  return `path:${path}`
}
