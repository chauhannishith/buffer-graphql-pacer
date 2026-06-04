import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferRateLimiter } from '../src/limiter'
import {
  getBufferApiRequestCount,
  MOCK_BUFFER_GRAPHQL_URL,
  setBufferApiRequestCount,
} from './mocks/buffer-api'

const mockFetch = (): Promise<Response> =>
  fetch(MOCK_BUFFER_GRAPHQL_URL, { method: 'POST', body: '{}' })

describe('pacing-429 (MSW)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('syncs RateLimit-Remaining from mock responses', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 100,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    await limiter.schedule(mockFetch)

    expect(limiter.getState().rateLimitRemaining).toBe(99)
  })

  it('pauses on mock 429 and retries after retryAfter seconds', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 100,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    setBufferApiRequestCount(100)

    const promise = limiter.schedule(mockFetch)

    await vi.advanceTimersByTimeAsync(0)
    expect(limiter.getState().pausedUntil).not.toBeNull()

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(10_001)
    const response = await promise

    expect(response.status).toBe(200)
    expect(getBufferApiRequestCount()).toBeGreaterThanOrEqual(1)
    expect(limiter.getState().pausedUntil).toBeNull()
  })
})
