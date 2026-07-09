# Workflow Monitor

TypeScript monitor frontend and Bun server for loop workflows.

## Contract

This UI is intentionally decoupled from any specific runner implementation.

- Runners produce:
  - `artifacts/workflow-monitor.snapshot.json`
  - `artifacts/workflow-monitor.events.jsonl`
- The monitor server scans a shared runs root recursively and reads only per-run snapshot files.
- The React frontend reads only `/api/runs`, `/api/runs/stream`, `/api/snapshot?run=<id>`, `/api/stream?run=<id>`, and file-preview endpoints under `/api/file/*`.

That means the interaction boundary is a file-based monitor snapshot contract, not direct imports from Python or Bun runner internals.

The live transport is SSE. The browser subscribes to the Bun server, while the Bun server polls the file contract and pushes updates downstream. File preview stays read-only and is limited to allowed repo-local roots after real-path validation.

The run library supports search, activity/status filters, sorting, active/stale detection, and nested `<workflow>/<run>` layouts. The run detail view adds execution-path highlighting, live follow mode, durations, node activity, file readiness, Markdown/JSON preview, and full-screen artifact inspection.

## Local Usage

1. Install dependencies:

```bash
bun install
```

2. Build the frontend:

```bash
bun run build
```

3. Start the server. By default it recursively scans the repo-local `.runs` root:

```bash
bun run start
```

Optional: point it at another runs root or preselect one run:

```bash
bun run start -- --runs-root /abs/path/to/.runs --default-run /abs/path/to/.runs/operator-dsl-loop/<run-slug>
```

Long-running runners should refresh the snapshot file mtime or publish `workflow.heartbeatAt` at least once per minute. Configure stale detection and recursive scan depth when needed:

```bash
bun run start -- --runs-root /abs/path/to/.runs --stale-ms 60000 --catalog-poll-ms 5000 --max-depth 3
```

4. Open the run library:

```text
http://127.0.0.1:4174
```

## Development

Start the Vite frontend separately:

```bash
bun run dev
```

Start the API server in another terminal:

```bash
bun run start
```
