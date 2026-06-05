import type { PacingStatus } from '../limiter'

export const formatResetCountdown = (resetAtMs: number | null, now = Date.now()): string => {
  if (resetAtMs === null) {
    return '--'
  }
  const diffMs = Math.max(0, resetAtMs - now)
  const minutes = Math.floor(diffMs / 60_000)
  const seconds = Math.floor((diffMs % 60_000) / 1_000)
  return `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
}

export const formatPacingStatus = (status: PacingStatus): string => status.toUpperCase()

export const formatProgressBar = (completed: number, total: number, width = 16): string => {
  if (total <= 0) {
    return '░'.repeat(width)
  }
  const ratio = Math.min(1, completed / total)
  const filled = Math.round(ratio * width)
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)}`
}

export const formatPercent = (completed: number, total: number): number => {
  if (total <= 0) {
    return 0
  }
  return Math.min(100, Math.round((completed / total) * 100))
}

export const formatHttpStatusSummary = (counts: Record<string, number>): string => {
  const entries = Object.entries(counts).sort(
    ([left], [right]) => Number.parseInt(left, 10) - Number.parseInt(right, 10),
  )
  if (entries.length === 0) {
    return '--'
  }
  return entries.map(([status, count]) => `${status}×${count}`).join(', ')
}

const HTTP_STATUS_LABELS: Record<number, string> = {
  200: 'OK',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Server Error',
  502: 'Bad Gateway',
  503: 'Unavailable',
  504: 'Gateway Timeout',
}

/** Human-readable label for the last response status (dashboard). */
export const formatLastHttpStatus = (status: number | null): string => {
  if (status === null) {
    return '--'
  }
  const label = HTTP_STATUS_LABELS[status]
  return label ? `${status} ${label}` : `${status}`
}

export const formatPauseReason = (reason: string | null): string => {
  if (reason === 'failure') {
    return 'FAILURE WAIT'
  }
  if (reason === 'rate_limit') {
    return 'RATE LIMIT'
  }
  return '--'
}

const BLOCKS = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

/** Map a bucket count to a block character for the equalizer. */
export const bucketToBlock = (count: number, maxCount: number): string => {
  if (count <= 0 || maxCount <= 0) {
    return BLOCKS[0]
  }
  const index = Math.min(
    BLOCKS.length - 1,
    Math.max(1, Math.ceil((count / maxCount) * (BLOCKS.length - 1))),
  )
  return BLOCKS[index] ?? BLOCKS[0]
}
