import { Box, Text, useInput } from 'ink'
import React, { useEffect, useState } from 'react'
import type { BufferRateLimiter } from '../limiter'
import { ProgressBar } from './components/ProgressBar'
import { RequestEqualizer } from './components/RequestEqualizer'
import { TelemetryPanel } from './components/TelemetryPanel'

type DashboardProps = {
  limiter: BufferRateLimiter
  title?: string
  itemLabel?: string
  onQuit?: () => void
}

export const Dashboard = ({
  limiter,
  title = 'BUFFER RATE OPTIMIZER',
  itemLabel = 'Posts',
  onQuit,
}: DashboardProps): React.JSX.Element => {
  const [tick, setTick] = useState(0)

  useInput((input) => {
    if (input === 'q') {
      onQuit?.()
    }
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((value) => value + 1)
    }, 100)
    return () => clearInterval(interval)
  }, [])

  void tick
  const state = limiter.getState()

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        {'='.repeat(23)} {title} {'='.repeat(23)}
      </Text>
      <ProgressBar
        succeeded={state.totalSucceeded}
        failed={state.totalFailed}
        completed={state.totalCompleted}
        total={state.totalScheduled}
        label={itemLabel}
      />
      <TelemetryPanel state={state} />
      <RequestEqualizer buckets={state.requestBuckets} />
      {state.inFlight ? <Text dimColor>▸ request in flight…</Text> : null}
      <Text dimColor>Press q to stop · Ctrl+C also exits</Text>
    </Box>
  )
}
