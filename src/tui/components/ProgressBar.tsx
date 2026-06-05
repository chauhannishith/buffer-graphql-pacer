import { Box, Text } from 'ink'
import React from 'react'
import { formatPercent, formatProgressBar } from '../format'

type ProgressBarProps = {
  succeeded: number
  failed: number
  completed: number
  total: number
  label?: string
}

export const ProgressBar = ({
  succeeded,
  failed,
  completed,
  total,
  label = 'Posts',
}: ProgressBarProps): React.JSX.Element => {
  const percent = formatPercent(completed, total)
  const bar = formatProgressBar(completed, total)
  const pending = Math.max(0, total - completed)

  return (
    <Box flexDirection="column">
      <Text>
        [Queue Status] {succeeded} ok · {failed} failed · {pending} pending / {total} {label} [{bar}
        ] {percent}%
      </Text>
    </Box>
  )
}
