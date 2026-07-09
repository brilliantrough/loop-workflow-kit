import { useEffect, useMemo, useState } from "react"

import { fetchRuns, subscribeToRuns } from "@/lib/api"
import type { WorkflowRunRecord, WorkflowStreamState } from "@/lib/types"

type RunsState = {
  readonly defaultRunId: string | null
  readonly error: string | null
  readonly runs: readonly WorkflowRunRecord[]
  readonly runsRoot: string | null
  readonly streamState: WorkflowStreamState
}

export function useWorkflowRuns(): RunsState {
  const [defaultRunId, setDefaultRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<readonly WorkflowRunRecord[]>([])
  const [runsRoot, setRunsRoot] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<WorkflowStreamState>("connecting")

  useEffect(() => {
    let mounted = true
    setStreamState("connecting")

    void fetchRuns()
      .then((next) => {
        if (!mounted) {
          return
        }
        setStreamState("connected")
        setDefaultRunId(next.defaultRunId)
        setError(null)
        setRuns(next.runs)
        setRunsRoot(next.runsRoot)
      })
      .catch((nextError) => {
        if (!mounted) {
          return
        }
        setStreamState("reconnecting")
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      })

    const unsubscribe = subscribeToRuns({
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
        setError(nextError.message)
      },
      onRuns(next) {
        if (!mounted) {
          return
        }
        setStreamState("connected")
        setDefaultRunId(next.defaultRunId)
        setError(null)
        setRuns(next.runs)
        setRunsRoot(next.runsRoot)
      },
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return useMemo(
    () => ({
      defaultRunId,
      error,
      runs,
      runsRoot,
      streamState,
    }),
    [defaultRunId, error, runs, runsRoot, streamState],
  )
}
