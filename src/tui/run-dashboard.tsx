import { render } from 'ink'
import React from 'react'
import type { BufferRateLimiter } from '../limiter'
import { Dashboard } from './Dashboard'

export type RunDashboardOptions = {
  title?: string
  itemLabel?: string
  /** Milliseconds to keep the final frame visible before exit. */
  holdMs?: number
}

export type RunPacedWorkOptions = RunDashboardOptions & {
  /**
   * Show the Ink terminal dashboard while work runs.
   * @default false — pacing works silently unless you opt in
   */
  dashboard?: boolean | RunDashboardOptions
}

const resolveDashboardOptions = (
  dashboard: boolean | RunDashboardOptions | undefined,
  defaults: RunDashboardOptions,
): RunDashboardOptions | null => {
  if (dashboard === undefined || dashboard === false) {
    return null
  }
  if (dashboard === true) {
    return defaults
  }
  return { ...defaults, ...dashboard }
}

export const runWithDashboard = async (
  limiter: BufferRateLimiter,
  work: () => Promise<unknown>,
  options: RunDashboardOptions = {},
): Promise<void> => {
  const holdMs = options.holdMs ?? 1_500
  const instance = render(
    <Dashboard
      limiter={limiter}
      title={options.title ?? 'BUFFER RATE OPTIMIZER'}
      itemLabel={options.itemLabel ?? 'Posts'}
    />,
  )

  try {
    await work()
  } finally {
    await new Promise((resolve) => {
      setTimeout(resolve, holdMs)
    })
    instance.unmount()
  }
}

/**
 * Run paced work with an optional terminal dashboard.
 * Dashboard is **off by default**; pass `dashboard: true` to enable.
 */
export const runPacedWork = async (
  limiter: BufferRateLimiter,
  work: () => Promise<unknown>,
  options: RunPacedWorkOptions = {},
): Promise<void> => {
  const { dashboard, ...dashboardDefaults } = options
  const dashOptions = resolveDashboardOptions(dashboard, dashboardDefaults)

  if (dashOptions === null) {
    await work()
    return
  }

  await runWithDashboard(limiter, work, dashOptions)
}
