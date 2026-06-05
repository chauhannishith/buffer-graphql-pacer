import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestMetrics } from '../src/telemetry/request-metrics'

describe('RequestMetrics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts completions in the last minute for requests per minute', () => {
    const metrics = new RequestMetrics()

    metrics.recordCompletion(Date.now())
    vi.advanceTimersByTime(30_000)
    metrics.recordCompletion(Date.now())

    expect(metrics.getRequestsPerMinute()).toBe(2)

    vi.advanceTimersByTime(31_000)
    expect(metrics.getRequestsPerMinute()).toBe(1)
  })

  it('returns rolling bucket counts for sparkline data', () => {
    const metrics = new RequestMetrics({ bucketCount: 5, bucketMs: 1_000 })

    metrics.recordCompletion(Date.now())
    vi.advanceTimersByTime(2_000)
    metrics.recordCompletion(Date.now())
    metrics.recordCompletion(Date.now())

    const buckets = metrics.getBucketCounts()
    expect(buckets).toHaveLength(5)
    expect(buckets.reduce((sum, count) => sum + count, 0)).toBe(3)
  })
})
