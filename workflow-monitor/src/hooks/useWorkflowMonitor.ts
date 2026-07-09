import { useEffect, useMemo, useState } from "react"

import { MonitorApiError, fetchSnapshot, subscribeToSnapshot } from "@/lib/api"
import type { WorkflowMonitorSnapshot, WorkflowMonitorStatus, WorkflowStreamState } from "@/lib/types"

type MonitorState = {
  readonly error: string | null
  readonly snapshot: WorkflowMonitorSnapshot | null
  readonly streamState: WorkflowStreamState
}

export function useWorkflowMonitor(runId: string | null): MonitorState {
  const [snapshot, setSnapshot] = useState<WorkflowMonitorSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<WorkflowStreamState>("connecting")

  useEffect(() => {
    if (runId === null) {
      setError(null)
      setSnapshot(null)
      setStreamState("connecting")
      return
    }
    let mounted = true
    setStreamState("connecting")
    setError(null)
    setSnapshot(null)

    void fetchSnapshot(runId)
      .then((next) => {
        if (!mounted) {
          return
        }
        setSnapshot(next)
        setStreamState("connected")
        setError(null)
      })
      .catch((nextError) => {
        if (!mounted) {
          return
        }
        if (isSnapshotMissingError(nextError)) {
          setError(null)
          return
        }
        setStreamState("reconnecting")
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      })

    const unsubscribe = subscribeToSnapshot(runId, {
      onStreamStateChange(next) {
        if (!mounted) {
          return
        }
        setStreamState(next)
      },
      onError(nextError) {
        if (!mounted) {
          return
        }
        if (isSnapshotMissingError(nextError)) {
          setError(null)
          return
        }
        setError(nextError.message)
      },
      onSnapshot(next) {
        if (!mounted) {
          return
        }
        setSnapshot(next)
        setStreamState("connected")
        setError(null)
      },
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [runId])

  return useMemo(
    () => ({
      error,
      snapshot,
      streamState,
    }),
    [error, snapshot, streamState],
  )
}

export function isTerminalStatus(status: WorkflowMonitorStatus): boolean {
  return status === "completed" || status === "failed" || status === "approved" || status === "rejected"
}

function isSnapshotMissingError(error: unknown): boolean {
  return error instanceof MonitorApiError && error.code === "snapshot_not_found"
}
