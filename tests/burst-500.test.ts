import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferRateLimiter } from '../src/limiter'
import { MOCK_BUFFER_GRAPHQL_URL } from './mocks/buffer-api'

const mockFetch = (): Promise<Response> =>
  fetch(MOCK_BUFFER_GRAPHQL_URL, { method: 'POST', body: '{}' })

const advanceTimersThenAwaitAll = async <T>(
  promises: Promise<T>[],
  stepMs: number,
  steps: number,
): Promise<T[]> => {
  const all = Promise.all(promises)
  for (let step = 0; step < steps; step++) {
    await vi.advanceTimersByTimeAsync(stepMs)
  }
  return all
}

describe('burst-500 (MSW)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('unpaced parallel burst receives HTTP 429 from the mock', async () => {
    const responses = await Promise.all(Array.from({ length: 120 }, mockFetch))

    expect(responses.some((response) => response.status === 429)).toBe(true)
    expect(responses.some((response) => response.status === 200)).toBe(true)
  })

  it('paced burst of 500 completes without surfacing 429 to the caller', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 100,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
      defaultRetryAfterSeconds: 5,
    })

    const promises = Array.from({ length: 500 }, () => limiter.schedule(mockFetch))
    const responses = await advanceTimersThenAwaitAll(promises, 1_000, 120)

    expect(responses).toHaveLength(500)
    expect(responses.every((response) => response.status === 200)).toBe(true)
  }, 30_000)
})
