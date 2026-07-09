import { describe, expect, test } from "bun:test"

import { filterAndSortRuns, formatDuration, nodeDurationMs } from "./monitor"
import type { WorkflowNodeState, WorkflowRunRecord } from "./types"

const BASE_RUN: WorkflowRunRecord = {
  activityState: "terminal",
  backend: "pyasc",
  completedAt: "2026-07-10T01:10:00.000Z",
  currentNodeId: "finalize",
  hasSnapshot: true,
  heartbeatAt: "2026-07-10T01:10:00.000Z",
  id: "alpha-run",
  metadata: { team: "compiler" },
  operatorDir: "operators/alpha",
  runDirectory: "/tmp/alpha-run",
  startedAt: "2026-07-10T01:00:00.000Z",
  status: "completed",
  subject: "operators/alpha",
  updatedAt: "2026-07-10T01:10:00.000Z",
  workflowName: "operator-loop",
}

describe("workflow monitor presentation helpers", () => {
  test("formats durations without dropping useful precision", () => {
    expect(formatDuration(4_000)).toBe("4s")
    expect(formatDuration(125_000)).toBe("2m 5s")
    expect(formatDuration(7_500_000)).toBe("2h 5m")
  })

  test("filters stale runs and searches generic run metadata", () => {
    const stale = { ...BASE_RUN, activityState: "stale" as const, id: "beta-run", operatorDir: "operators/beta", status: "running" as const }
    expect(filterAndSortRuns([BASE_RUN, stale], { filter: "stale", query: "beta", sort: "updated" })).toEqual([stale])
    expect(filterAndSortRuns([BASE_RUN, stale], { filter: "all", query: "pyasc", sort: "name" })).toHaveLength(2)
  })

  test("uses the current clock for a running node", () => {
    const state: WorkflowNodeState = {
      attempts: 1,
      completedAt: null,
      current: true,
      startedAt: "2026-07-10T01:00:00.000Z",
      status: "running",
      updatedAt: "2026-07-10T01:00:00.000Z",
    }
    expect(nodeDurationMs(state, Date.parse("2026-07-10T01:02:03.000Z"))).toBe(123_000)
  })
})
