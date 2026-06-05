import { Box, Text } from 'ink'
import React from 'react'
import { bucketToBlock } from '../format'

type RequestEqualizerProps = {
  buckets: number[]
}

export const RequestEqualizer = ({ buckets }: RequestEqualizerProps): React.JSX.Element => {
  const maxCount = Math.max(...buckets, 1)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>[Live Pacing Load]</Text>
      <Text>{'─'.repeat(69)}</Text>
      <Box flexDirection="row" marginTop={1}>
        {buckets.map((count, index) => (
          <Text key={`bucket-${index}`}>{bucketToBlock(count, maxCount)}</Text>
        ))}
      </Box>
      <Text dimColor>{' '.repeat(4)}[ rolling request frequency — newest on the right ]</Text>
    </Box>
  )
}
