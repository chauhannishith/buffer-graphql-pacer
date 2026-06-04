import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBufferedFetch } from '../src/adapters/fetch'
import { BufferRateLimiter } from '../src/limiter'
import { MOCK_BUFFER_GRAPHQL_URL } from './mocks/buffer-api'

describe('createBufferedFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('routes requests through the limiter and returns a Response', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 100,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    const bufferedFetch = createBufferedFetch(limiter)
    const responsePromise = bufferedFetch(MOCK_BUFFER_GRAPHQL_URL, {
      method: 'POST',
      body: '{}',
    })

    await vi.advanceTimersByTimeAsync(0)
    const response = await responsePromise

    expect(response.status).toBe(200)
    expect(limiter.getState().rateLimitRemaining).toBe(99)
  })

  it('forwards method, body, and headers to the underlying fetch', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    const calls: { input: string | URL | globalThis.Request; init?: RequestInit }[] = []
    const mockBaseFetch: typeof fetch = async (input, init) => {
      if (init === undefined) {
        calls.push({ input })
      } else {
        calls.push({ input, init })
      }
      return new Response('{}', {
        status: 200,
        headers: {
          'RateLimit-Limit': '10',
          'RateLimit-Remaining': '9',
          'RateLimit-Reset': new Date(Date.now() + 10_000).toISOString(),
        },
      })
    }

    const bufferedFetch = createBufferedFetch({ limiter, fetch: mockBaseFetch })
    await bufferedFetch('https://example.test/graphql', {
      method: 'POST',
      body: '{"query":"{ organizations { id } }"}',
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toContain('organizations')
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })
})
