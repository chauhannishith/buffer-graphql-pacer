import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphQLClient } from 'graphql-request'
import { createGraphqlRequestFetch } from '../src/adapters/graphql-request'
import { BufferRateLimiter } from '../src/limiter'
import { MOCK_BUFFER_GRAPHQL_URL } from './mocks/buffer-api'

describe('createGraphqlRequestFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('works as GraphQLClient fetch option against the msw mock', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 100,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    const client = new GraphQLClient(MOCK_BUFFER_GRAPHQL_URL, {
      fetch: createGraphqlRequestFetch(limiter),
    })

    const requestPromise = client.request('{ ok }')
    await vi.advanceTimersByTimeAsync(0)
    const data = await requestPromise

    expect(data).toEqual({ ok: true })
    expect(limiter.getState().rateLimitRemaining).toBe(99)
  })
})
