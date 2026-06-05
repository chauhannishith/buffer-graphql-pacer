import { Box, Text } from 'ink'
import React from 'react'
import { formatPercent, formatProgressBar } from '../format'

type ProgressBarProps = {
  completed: number
  total: number
  label?: string
}

export const ProgressBar = ({
  completed,
  total,
  label = 'Posts',
}: ProgressBarProps): React.JSX.Element => {
  const percent = formatPercent(completed, total)
  const bar = formatProgressBar(completed, total)

  return (
    <Box flexDirection="column">
      <Text>
        [Queue Status] Processing: {completed} / {total} {label} [{bar}] {percent}%
      </Text>
    </Box>
  )
}
