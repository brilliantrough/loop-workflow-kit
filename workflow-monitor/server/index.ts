import { open, readdir, realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path"

type ServerOptions = {
  readonly catalogPollMs: number
  readonly clientDist: string
  readonly defaultRunId: string | null
  readonly host: string
  readonly maxDepth: number
  readonly pollMs: number
  readonly port: number
  readonly repoRoot: string
  readonly runsRoot: string
  readonly staleMs: number
}

type RunSnapshotCache = {
  lastMtimeMs: number
  lastSnapshotText: string
}

type WorkflowMonitorStatus =
  | "idle"
  | "ready"
  | "running"
  | "pending"
  | "completed"
  | "failed"
  | "approved"
  | "rejected"

type RunsIndexPayload = {
  readonly defaultRunId: string | null
  readonly runs: readonly WorkflowRunRecord[]
  readonly runsRoot: string
}

type WorkflowRunRecord = {
  readonly activityState: "active" | "stale" | "terminal" | "unknown"
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
  readonly status: WorkflowMonitorStatus | "unknown"
  readonly subject: string | null
  readonly updatedAt: string
  readonly workflowName: string | null
}

type FilePreviewPayload = {
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

type FileStatusPayload = {
  readonly exists: boolean
  readonly kind: "text" | "image" | "binary" | "directory" | "missing"
  readonly modifiedAt: string | null
  readonly path: string
  readonly sizeBytes: number | null
}

const encoder = new TextEncoder()
const options = parseArgs(process.argv.slice(2))
const runSubscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
const snapshotSubscribers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()
const snapshotCache = new Map<string, RunSnapshotCache>()
const lastBroadcastSnapshotText = new Map<string, string>()
const TEXT_PREVIEW_BYTES = 128 * 1024

let lastRunsPayloadText = ""
let lastCatalogPollAt = 0

async function pollMonitorFiles(): Promise<void> {
  const now = Date.now()
  if (now - lastCatalogPollAt >= options.catalogPollMs) {
    lastCatalogPollAt = now
    const payload = await buildRunsIndexPayload()
    const payloadText = JSON.stringify(payload)
    if (payloadText !== lastRunsPayloadText) {
      lastRunsPayloadText = payloadText
      broadcastRuns(payloadText)
    }
  }

  const runIds = new Set<string>(snapshotSubscribers.keys())
  for (const runId of runIds) {
    const next = await readSnapshotText(runId)
    const previous = lastBroadcastSnapshotText.get(runId) ?? null
    if (next === null) {
      if (previous !== null) {
        snapshotCache.delete(runId)
        lastBroadcastSnapshotText.delete(runId)
        broadcastSnapshot(
          runId,
          "snapshot-error",
          JSON.stringify({
            error: "snapshot_not_found",
            message: `Missing workflow monitor snapshot for run ${runId}`,
          }),
        )
      }
      continue
    }
    if (next === previous) {
      continue
    }
    lastBroadcastSnapshotText.set(runId, next)
    broadcastSnapshot(runId, "snapshot", next)
  }
}

async function runPollLoop(): Promise<void> {
  try {
    await pollMonitorFiles()
  } catch (error) {
    console.error(`[workflow-monitor] poll_error=${error instanceof Error ? error.message : String(error)}`)
  } finally {
    setTimeout(() => void runPollLoop(), options.pollMs)
  }
}

void runPollLoop()

setInterval(() => {
  const payload = JSON.stringify({ timestamp: new Date().toISOString() })
  broadcastRunsEvent("ping", payload)
  for (const runId of snapshotSubscribers.keys()) {
    broadcastSnapshot(runId, "ping", payload)
  }
}, 15000)

const server = Bun.serve({
  hostname: options.host,
  port: options.port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/files/status" && request.method === "POST") {
      let requestedPaths: unknown
      try {
        const payload = (await request.json()) as { paths?: unknown }
        requestedPaths = payload.paths
      } catch {
        return Response.json({ error: "invalid_json", message: "Expected a JSON body" }, { status: 400 })
      }
      if (!Array.isArray(requestedPaths) || requestedPaths.length > 100 || requestedPaths.some((path) => typeof path !== "string")) {
        return Response.json(
          { error: "invalid_paths", message: "paths must be an array of at most 100 strings" },
          { status: 400 },
        )
      }
      const statuses = await Promise.all(
        requestedPaths.map(async (path) => {
          const resolvedPath = await filePathFromValue(path, true)
          if (resolvedPath instanceof Response) {
            return { exists: false, kind: "missing", modifiedAt: null, path, sizeBytes: null } satisfies FileStatusPayload
          }
          return buildFileStatus(resolvedPath, path)
        }),
      )
      return Response.json({ files: statuses })
    }
    if (url.pathname === "/api/file/preview") {
      const path = await filePathFromRequest(url)
      if (path instanceof Response) {
        return path
      }
      return Response.json(await buildFilePreview(path))
    }
    if (url.pathname === "/api/file/raw") {
      const path = await filePathFromRequest(url)
      if (path instanceof Response) {
        return path
      }
      return serveRawFile(path, url.searchParams.get("download") === "1")
    }
    if (url.pathname === "/api/health") {
      return Response.json({
        defaultRunId: options.defaultRunId,
        ok: true,
        runsRoot: options.runsRoot,
      })
    }
    if (url.pathname === "/api/runs") {
      return Response.json(await buildRunsIndexPayload())
    }
    if (url.pathname === "/api/runs/stream") {
      let currentController: ReadableStreamDefaultController<Uint8Array> | null = null
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            currentController = controller
            runSubscribers.add(controller)
            controller.enqueue(encodeEvent("runs", JSON.stringify(await buildRunsIndexPayload())))
          },
          cancel() {
            if (currentController !== null) {
              runSubscribers.delete(currentController)
            }
          },
        }),
        {
          headers: {
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "content-type": "text/event-stream",
            "x-accel-buffering": "no",
          },
        },
      )
    }
    if (url.pathname === "/api/snapshot") {
      const runId = runIdFromRequest(url)
      if (runId instanceof Response) {
        return runId
      }
      const snapshot = await readSnapshotText(runId)
      if (snapshot === null) {
        return Response.json(
          {
            error: "snapshot_not_found",
            message: `Missing workflow monitor snapshot for run ${runId}`,
          },
          { status: 404 },
        )
      }
      return new Response(snapshot, {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      })
    }
    if (url.pathname === "/api/stream") {
      const runId = runIdFromRequest(url)
      if (runId instanceof Response) {
        return runId
      }
      let currentController: ReadableStreamDefaultController<Uint8Array> | null = null
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            currentController = controller
            const subscribers = snapshotSubscribers.get(runId) ?? new Set<ReadableStreamDefaultController<Uint8Array>>()
            subscribers.add(controller)
            snapshotSubscribers.set(runId, subscribers)
            const snapshot = await readSnapshotText(runId)
            if (snapshot !== null) {
              lastBroadcastSnapshotText.set(runId, snapshot)
              controller.enqueue(encodeEvent("snapshot", snapshot))
            } else {
              controller.enqueue(
                encodeEvent(
                  "snapshot-error",
                  JSON.stringify({
                    error: "snapshot_not_found",
                    message: `Missing workflow monitor snapshot for run ${runId}`,
                  }),
                ),
              )
            }
          },
          cancel() {
            if (currentController === null) {
              return
            }
            const subscribers = snapshotSubscribers.get(runId)
            if (subscribers === undefined) {
              return
            }
            subscribers.delete(currentController)
            if (subscribers.size === 0) {
              snapshotSubscribers.delete(runId)
            }
          },
        }),
        {
          headers: {
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "content-type": "text/event-stream",
            "x-accel-buffering": "no",
          },
        },
      )
    }
    return serveStatic(url.pathname, options.clientDist)
  },
})

console.log(`[workflow-monitor] url=http://${options.host}:${options.port}`)
console.log(`[workflow-monitor] runs_root=${options.runsRoot}`)
if (!["127.0.0.1", "::1", "localhost"].includes(options.host)) {
  console.warn("[workflow-monitor] warning=non-loopback host exposes repo-local preview APIs; use a trusted network boundary")
}
if (options.defaultRunId !== null) {
  console.log(`[workflow-monitor] default_run=${join(options.runsRoot, options.defaultRunId)}`)
}

function parseArgs(argv: readonly string[]): ServerOptions {
  const repoRoot = resolve(process.cwd(), "..")
  const defaults = {
    catalogPollMs: 5_000,
    clientDist: join(process.cwd(), "dist"),
    defaultRun: null as string | null,
    host: "127.0.0.1",
    maxDepth: 3,
    pollMs: 1000,
    port: 4174,
    runDir: null as string | null,
    runsRoot: join(repoRoot, ".runs"),
    staleMs: 60_000,
  }
  const next = { ...defaults }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const value = argv[index + 1]
    if (token === "--run-dir" && value) {
      next.runDir = value
      index += 1
      continue
    }
    if (token === "--runs-root" && value) {
      next.runsRoot = value
      index += 1
      continue
    }
    if (token === "--default-run" && value) {
      next.defaultRun = value
      index += 1
      continue
    }
    if (token === "--host" && value) {
      next.host = value
      index += 1
      continue
    }
    if (token === "--port" && value) {
      next.port = Number(value)
      index += 1
      continue
    }
    if (token === "--poll-ms" && value) {
      next.pollMs = Number(value)
      index += 1
      continue
    }
    if (token === "--catalog-poll-ms" && value) {
      next.catalogPollMs = Number(value)
      index += 1
      continue
    }
    if (token === "--stale-ms" && value) {
      next.staleMs = Number(value)
      index += 1
      continue
    }
    if (token === "--max-depth" && value) {
      next.maxDepth = Number(value)
      index += 1
      continue
    }
    if (token === "--client-dist" && value) {
      next.clientDist = value
      index += 1
      continue
    }
  }
  const runsRoot = resolve(next.runDir ? join(next.runDir, "..") : next.runsRoot)
  const defaultRunInput = next.defaultRun ?? next.runDir
  const defaultRunId = defaultRunInput ? toRunId(defaultRunInput, runsRoot) : null
  return {
    catalogPollMs: next.catalogPollMs,
    clientDist: resolve(next.clientDist),
    defaultRunId,
    host: next.host,
    maxDepth: next.maxDepth,
    pollMs: next.pollMs,
    port: next.port,
    repoRoot,
    runsRoot,
    staleMs: next.staleMs,
  }
}

async function buildRunsIndexPayload(): Promise<RunsIndexPayload> {
  return {
    defaultRunId: options.defaultRunId,
    runs: await listRuns(),
    runsRoot: options.runsRoot,
  }
}

async function listRuns(): Promise<WorkflowRunRecord[]> {
  try {
    const runIds = await discoverRunIds()
    const runs = await Promise.all(runIds.map(async (runId) => summarizeRun(runId)))
    return runs.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt)
      const rightTime = Date.parse(right.updatedAt)
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime
      }
      return left.id.localeCompare(right.id)
    })
  } catch {
    return []
  }
}

async function discoverRunIds(relativeDirectory = "", depth = 0): Promise<string[]> {
  const directory = join(options.runsRoot, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const runIds: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "backups" || entry.name === "node_modules") {
      continue
    }
    const runId = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name
    if (await isLikelyRunDirectory(runId)) {
      runIds.push(runId)
      continue
    }
    if (depth < options.maxDepth) {
      runIds.push(...(await discoverRunIds(runId, depth + 1)))
    }
  }
  return runIds
}

async function isLikelyRunDirectory(runId: string): Promise<boolean> {
  const runDirectory = join(options.runsRoot, runId)
  const candidates = [
    join(runDirectory, ".operator-dsl-loop-run"),
    join(runDirectory, "artifacts", "input.json"),
    pathForSnapshot(runId),
  ]
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      return true
    }
  }
  return false
}

async function summarizeRun(runId: string): Promise<WorkflowRunRecord> {
  const runDirectory = join(options.runsRoot, runId)
  const snapshotPath = pathForSnapshot(runId)
  const snapshotText = await readSnapshotText(runId)
  if (snapshotText !== null) {
    try {
      const snapshot = JSON.parse(snapshotText) as {
        execution?: { currentNodeId?: unknown }
        nodeStates?: Record<string, { completedAt?: unknown; startedAt?: unknown }>
        runInput?: { backend?: unknown; operatorDir?: unknown }
        workflow?: {
          completedAt?: unknown
          heartbeatAt?: unknown
          metadata?: unknown
          name?: unknown
          startedAt?: unknown
          status?: unknown
          updatedAt?: unknown
        }
      }
      const status = isMonitorStatus(snapshot.workflow?.status) ? snapshot.workflow.status : "unknown"
      const fileStat = await stat(snapshotPath)
      const nodeStates = Object.values(snapshot.nodeStates ?? {})
      const startedAt = stringValue(snapshot.workflow?.startedAt) ?? earliestTimestamp(nodeStates.map((state) => state.startedAt))
      const updatedAt = stringValue(snapshot.workflow?.updatedAt) ?? new Date(fileStat.mtimeMs).toISOString()
      const heartbeatAt = stringValue(snapshot.workflow?.heartbeatAt) ?? new Date(fileStat.mtimeMs).toISOString()
      const completedAt = isTerminalMonitorStatus(status)
        ? stringValue(snapshot.workflow?.completedAt) ?? latestTimestamp(nodeStates.map((state) => state.completedAt)) ?? updatedAt
        : null
      return {
        activityState: activityStateFor(status, heartbeatAt),
        backend: typeof snapshot.runInput?.backend === "string" ? snapshot.runInput.backend : null,
        completedAt,
        currentNodeId: typeof snapshot.execution?.currentNodeId === "string" ? snapshot.execution.currentNodeId : null,
        hasSnapshot: true,
        heartbeatAt,
        id: runId,
        metadata: objectValue(snapshot.workflow?.metadata),
        operatorDir: typeof snapshot.runInput?.operatorDir === "string" ? snapshot.runInput.operatorDir : null,
        runDirectory,
        startedAt,
        status,
        subject:
          stringValue(objectValue(snapshot.workflow?.metadata).subject) ??
          (typeof snapshot.runInput?.operatorDir === "string" ? snapshot.runInput.operatorDir : null),
        updatedAt,
        workflowName: typeof snapshot.workflow?.name === "string" ? snapshot.workflow.name : null,
      }
    } catch {
      // fall through to filesystem summary
    }
  }

  let updatedAt = new Date(0).toISOString()
  try {
    const fileStat = await stat(snapshotPath)
    updatedAt = new Date(fileStat.mtimeMs).toISOString()
  } catch {
    try {
      const dirStat = await stat(runDirectory)
      updatedAt = new Date(dirStat.mtimeMs).toISOString()
    } catch {
      updatedAt = new Date(0).toISOString()
    }
  }
  return {
    activityState: "unknown",
    backend: null,
    completedAt: null,
    currentNodeId: null,
    hasSnapshot: false,
    heartbeatAt: updatedAt,
    id: runId,
    metadata: {},
    operatorDir: null,
    runDirectory,
    startedAt: null,
    status: "unknown",
    subject: null,
    updatedAt,
    workflowName: null,
  }
}

function runIdFromRequest(url: URL): string | Response {
  const runValue = url.searchParams.get("run")
  if (!runValue) {
    return Response.json(
      {
        error: "missing_run",
        message: "Missing required run query parameter",
      },
      { status: 400 },
    )
  }
  try {
    return toRunId(runValue, options.runsRoot)
  } catch (error) {
    return Response.json(
      {
        error: "invalid_run",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    )
  }
}

async function filePathFromRequest(url: URL): Promise<string | Response> {
  const pathValue = url.searchParams.get("path")
  if (!pathValue) {
    return Response.json(
      {
        error: "missing_path",
        message: "Missing required path query parameter",
      },
      { status: 400 },
    )
  }
  return filePathFromValue(pathValue, false)
}

async function filePathFromValue(pathValue: string, allowMissing: boolean): Promise<string | Response> {
  const candidate = resolve(isAbsolute(pathValue) ? pathValue : join(options.repoRoot, pathValue))
  if (!isInsideRoot(candidate, options.repoRoot) && !isInsideRoot(candidate, options.runsRoot)) {
    return Response.json(
      {
        error: "path_outside_allowed_roots",
        message: `Path ${pathValue} is outside the monitor preview roots`,
      },
      { status: 403 },
    )
  }
  if (!(await Bun.file(candidate).exists())) {
    if (allowMissing) {
      return candidate
    }
    return Response.json(
      {
        error: "file_not_found",
        message: `Missing file ${candidate}`,
      },
      { status: 404 },
    )
  }
  const resolvedCandidate = await realpath(candidate)
  const resolvedRoots = (
    await Promise.all([existingRealPath(options.repoRoot), existingRealPath(options.runsRoot)])
  ).filter((root): root is string => root !== null)
  if (!resolvedRoots.some((root) => isInsideRoot(resolvedCandidate, root))) {
    return Response.json(
      {
        error: "path_outside_allowed_roots",
        message: `Resolved path ${pathValue} is outside the monitor preview roots`,
      },
      { status: 403 },
    )
  }
  return resolvedCandidate
}

function toRunId(value: string, runsRoot: string): string {
  const candidate = resolve(value.startsWith("/") ? value : join(runsRoot, value))
  const runId = relative(runsRoot, candidate)
  if (runId.length === 0 || runId.startsWith("..")) {
    throw new Error(`Run directory ${value} is outside runs root ${runsRoot}`)
  }
  return runId
}

async function readSnapshotText(runId: string): Promise<string | null> {
  const snapshotPath = pathForSnapshot(runId)
  try {
    const file = Bun.file(snapshotPath)
    if (!(await file.exists())) {
      return null
    }
    const fileStat = await stat(snapshotPath)
    const cached = snapshotCache.get(runId)
    if (cached !== undefined && cached.lastMtimeMs === fileStat.mtimeMs && cached.lastSnapshotText.length > 0) {
      return cached.lastSnapshotText
    }
    const text = await file.text()
    snapshotCache.set(runId, { lastMtimeMs: fileStat.mtimeMs, lastSnapshotText: text })
    return text
  } catch {
    return null
  }
}

async function buildFilePreview(path: string): Promise<FilePreviewPayload> {
  const fileStat = await stat(path)
  const modifiedAt = new Date(fileStat.mtimeMs).toISOString()
  if (fileStat.isDirectory()) {
    return {
      content: null,
      kind: "directory",
      language: null,
      mediaType: null,
      modifiedAt,
      path,
      rawUrl: null,
      relativePath: relativeToKnownRoot(path),
      sizeBytes: 0,
      truncated: false,
    }
  }

  const extension = extname(path).toLowerCase()
  const mediaType = contentTypeForPath(path)
  if (isImageExtension(extension) && extension !== ".svg") {
    return {
      content: null,
      kind: "image",
      language: null,
      mediaType,
      modifiedAt,
      path,
      rawUrl: rawFileUrl(path),
      relativePath: relativeToKnownRoot(path),
      sizeBytes: fileStat.size,
      truncated: false,
    }
  }

  const snippet = await readFileSnippet(path, TEXT_PREVIEW_BYTES)
  if (isTextLike(extension, snippet.content)) {
    return {
      content: snippet.content.toString("utf-8"),
      kind: "text",
      language: languageForExtension(extension),
      mediaType,
      modifiedAt,
      path,
      rawUrl: rawFileUrl(path),
      relativePath: relativeToKnownRoot(path),
      sizeBytes: fileStat.size,
      truncated: snippet.truncated,
    }
  }

  return {
    content: null,
    kind: "binary",
    language: null,
    mediaType,
    modifiedAt,
    path,
    rawUrl: rawFileUrl(path),
    relativePath: relativeToKnownRoot(path),
    sizeBytes: fileStat.size,
    truncated: false,
  }
}

async function buildFileStatus(path: string, requestedPath: string): Promise<FileStatusPayload> {
  try {
    const fileStat = await stat(path)
    if (fileStat.isDirectory()) {
      return {
        exists: true,
        kind: "directory",
        modifiedAt: new Date(fileStat.mtimeMs).toISOString(),
        path: requestedPath,
        sizeBytes: 0,
      }
    }
    const extension = extname(path).toLowerCase()
    return {
      exists: true,
      kind: isImageExtension(extension) && extension !== ".svg" ? "image" : TEXT_EXTENSIONS.has(extension) ? "text" : "binary",
      modifiedAt: new Date(fileStat.mtimeMs).toISOString(),
      path: requestedPath,
      sizeBytes: fileStat.size,
    }
  } catch {
    return { exists: false, kind: "missing", modifiedAt: null, path: requestedPath, sizeBytes: null }
  }
}

async function serveRawFile(path: string, download: boolean): Promise<Response> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return Response.json(
      {
        error: "file_not_found",
        message: `Missing file ${path}`,
      },
      { status: 404 },
    )
  }
  const headers: Record<string, string> = {
    "content-security-policy": "default-src 'none'; sandbox",
    "content-type": download ? "application/octet-stream" : inlineContentTypeForPath(path),
    "x-content-type-options": "nosniff",
  }
  if (download) {
    headers["content-disposition"] = `attachment; filename="${basename(path).replaceAll('"', "")}"`
  }
  return new Response(file, { headers })
}

function rawFileUrl(path: string): string {
  return `/api/file/raw?path=${encodeURIComponent(path)}`
}

function inlineContentTypeForPath(path: string): string {
  const extension = extname(path).toLowerCase()
  if ([".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension)) {
    return contentTypeForPath(path)
  }
  return "text/plain; charset=utf-8"
}

async function readFileSnippet(path: string, limit: number): Promise<{ content: Buffer; truncated: boolean }> {
  const handle = await open(path, "r")
  try {
    const buffer = Buffer.alloc(limit + 1)
    const { bytesRead } = await handle.read(buffer, 0, limit + 1, 0)
    return {
      content: buffer.subarray(0, Math.min(bytesRead, limit)),
      truncated: bytesRead > limit,
    }
  } finally {
    await handle.close()
  }
}

function relativeToKnownRoot(path: string): string {
  if (isInsideRoot(path, options.runsRoot)) {
    return relative(options.runsRoot, path)
  }
  return relative(options.repoRoot, path)
}

function isInsideRoot(path: string, root: string): boolean {
  const next = relative(root, path)
  return next === "" || (!next.startsWith("..") && !isAbsolute(next))
}

async function existingRealPath(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

function isTextLike(extension: string, content: Buffer): boolean {
  if (TEXT_EXTENSIONS.has(extension)) {
    return true
  }
  for (const byte of content) {
    if (byte === 0) {
      return false
    }
  }
  return true
}

function isImageExtension(extension: string): boolean {
  return IMAGE_EXTENSIONS.has(extension)
}

function languageForExtension(extension: string): string | null {
  return LANGUAGE_BY_EXTENSION[extension] ?? null
}

function pathForSnapshot(runId: string): string {
  return join(options.runsRoot, runId, "artifacts", "workflow-monitor.snapshot.json")
}

function broadcastRuns(data: string): void {
  broadcastRunsEvent("runs", data)
}

function broadcastRunsEvent(event: string, data: string): void {
  const payload = encodeEvent(event, data)
  for (const controller of runSubscribers) {
    try {
      controller.enqueue(payload)
    } catch {
      runSubscribers.delete(controller)
    }
  }
}

function broadcastSnapshot(runId: string, event: string, data: string): void {
  const subscribers = snapshotSubscribers.get(runId)
  if (subscribers === undefined) {
    return
  }
  const payload = encodeEvent(event, data)
  for (const controller of subscribers) {
    try {
      controller.enqueue(payload)
    } catch {
      subscribers.delete(controller)
    }
  }
  if (subscribers.size === 0) {
    snapshotSubscribers.delete(runId)
  }
}

function encodeEvent(event: string, data: string): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${data.replaceAll("\n", "\ndata: ")}\n\n`)
}

async function serveStatic(pathname: string, clientDist: string): Promise<Response> {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname
  const targetPath = join(clientDist, normalizedPath)
  const targetFile = Bun.file(targetPath)
  if (await targetFile.exists()) {
    return new Response(targetFile, {
      headers: {
        "content-type": contentTypeForPath(targetPath),
      },
    })
  }
  const fallback = Bun.file(join(clientDist, "index.html"))
  if (await fallback.exists()) {
    return new Response(fallback, {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    })
  }
  return new Response(
    `Missing built frontend assets in ${clientDist}. Run 'bun run build' inside ${basename(process.cwd())}.`,
    { status: 503 },
  )
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8"
    case ".gif":
      return "image/gif"
    case ".html":
      return "text/html; charset=utf-8"
    case ".jpeg":
    case ".jpg":
      return "image/jpeg"
    case ".js":
      return "application/javascript; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".md":
      return "text/markdown; charset=utf-8"
    case ".png":
      return "image/png"
    case ".svg":
      return "image/svg+xml"
    case ".webp":
      return "image/webp"
    default:
      return "text/plain; charset=utf-8"
  }
}

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".csv",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".log",
  ".md",
  ".py",
  ".rst",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
])

const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"])

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".csv": "text",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".log": "text",
  ".md": "markdown",
  ".py": "python",
  ".rst": "text",
  ".sh": "bash",
  ".sql": "sql",
  ".svg": "xml",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".txt": "text",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
}

function isMonitorStatus(value: unknown): value is WorkflowMonitorStatus {
  return typeof value === "string" && ["idle", "ready", "running", "pending", "completed", "failed", "approved", "rejected"].includes(value)
}

function isTerminalMonitorStatus(status: WorkflowMonitorStatus | "unknown"): boolean {
  return status === "completed" || status === "failed" || status === "approved" || status === "rejected"
}

function activityStateFor(
  status: WorkflowMonitorStatus | "unknown",
  heartbeatAt: string | null,
): WorkflowRunRecord["activityState"] {
  if (isTerminalMonitorStatus(status)) {
    return "terminal"
  }
  if (status === "unknown" || heartbeatAt === null) {
    return "unknown"
  }
  const heartbeatTime = Date.parse(heartbeatAt)
  if (Number.isNaN(heartbeatTime)) {
    return "unknown"
  }
  return Date.now() - heartbeatTime <= options.staleMs ? "active" : "stale"
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function earliestTimestamp(values: readonly unknown[]): string | null {
  return extremeTimestamp(values, Math.min)
}

function latestTimestamp(values: readonly unknown[]): string | null {
  return extremeTimestamp(values, Math.max)
}

function extremeTimestamp(values: readonly unknown[], operation: (...values: number[]) => number): string | null {
  const timestamps = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter((value) => !Number.isNaN(value))
  if (timestamps.length === 0) {
    return null
  }
  return new Date(operation(...timestamps)).toISOString()
}
