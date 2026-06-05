import { Box, Text } from 'ink'
import React from 'react'
import type { BufferRateLimiterState } from '../../limiter'
import {
  formatHttpStatusSummary,
  formatLastHttpStatus,
  formatPacingStatus,
  formatPauseReason,
  formatResetCountdown,
} from '../format'

type TelemetryPanelProps = {
  state: BufferRateLimiterState
}

export const TelemetryPanel = ({ state }: TelemetryPanelProps): React.JSX.Element => {
  const pace = state.requestsPerMinute.toFixed(1)
  const status = formatPacingStatus(state.pacingStatus)
  const resetIn = formatResetCountdown(state.rateLimitResetAt)
  const pauseReason = formatPauseReason(state.pauseReason)
  const httpSummary = formatHttpStatusSummary(state.httpStatusCounts)
  const lastStatus = formatLastHttpStatus(state.lastHttpStatus)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>[Buffer API Telemetry]</Text>
      <Text>{'─'.repeat(69)}</Text>
      <Text>Last HTTP Status : {lastStatus}</Text>
      <Text>RateLimit-Limit : {state.rateLimitLimit ?? '--'}</Text>
      <Text>RateLimit-Remaining : {state.rateLimitRemaining ?? '--'}</Text>
      <Text>Window Reset In : {resetIn}</Text>
      <Text>Pause Reason : {pauseReason}</Text>
      <Text>HTTP Statuses : {httpSummary}</Text>
      <Text>
        Current Pace : {pace} requests / min [{status}]
      </Text>
    </Box>
  )
}
