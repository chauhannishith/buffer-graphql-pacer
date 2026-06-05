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
