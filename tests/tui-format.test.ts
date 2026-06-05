import { describe, expect, it } from 'vitest'
import {
  bucketToBlock,
  formatPacingStatus,
  formatPercent,
  formatProgressBar,
  formatResetCountdown,
} from '../src/tui/format'

describe('tui format helpers', () => {
  it('formats window reset countdown', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(formatResetCountdown(Date.parse('2026-01-01T00:08:42.000Z'), now)).toBe('08m 42s')
    expect(formatResetCountdown(null, now)).toBe('--')
  })

  it('formats progress bar and percent', () => {
    expect(formatProgressBar(68, 100, 10)).toBe('▓▓▓▓▓▓▓░░░')
    expect(formatPercent(68, 100)).toBe(68)
  })

  it('formats pacing status in uppercase', () => {
    expect(formatPacingStatus('stable')).toBe('STABLE')
    expect(formatPacingStatus('throttled')).toBe('THROTTLED')
  })

  it('maps bucket counts to block characters', () => {
    expect(bucketToBlock(0, 10)).toBe(' ')
    expect(bucketToBlock(10, 10)).toBe('█')
  })
})
