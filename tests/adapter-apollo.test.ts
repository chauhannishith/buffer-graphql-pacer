import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApolloClient, gql, HttpLink, InMemoryCache } from '@apollo/client/core'
import { BufferPacingLink } from '../src/adapters/apollo-link'
import { createBufferedFetch } from '../src/adapters/fetch'
import { BufferRateLimiter } from '../src/limiter'
import { MOCK_BUFFER_GRAPHQL_URL } from './mocks/buffer-api'

const TEST_QUERY = gql`
  query TestOk {
    ok
  }
`

describe('Apollo adapters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('HttpLink with createBufferedFetch returns data and syncs headers', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 100,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    const client = new ApolloClient({
      link: new HttpLink({
        uri: MOCK_BUFFER_GRAPHQL_URL,
        fetch: createBufferedFetch(limiter),
      }),
      cache: new InMemoryCache(),
    })

    const queryPromise = client.query({ query: TEST_QUERY })
    await vi.advanceTimersByTimeAsync(0)
    const result = await queryPromise

    expect(result.data).toEqual({ ok: true })
    expect(limiter.getState().rateLimitRemaining).toBe(99)
  })

  it('BufferPacingLink runs operations through the limiter one at a time', async () => {
    const limiter = new BufferRateLimiter({
      maxRequests: 10,
      windowMs: 10_000,
      safetyMargin: 1,
      lowWatermark: 0,
    })

    let inFlight = 0
    let maxInFlight = 0

    const trackingFetch: typeof fetch = async (input, init) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const response = await fetch(input, init)
      inFlight -= 1
      return response
    }

    const client = new ApolloClient({
      link: new BufferPacingLink(limiter).concat(
        new HttpLink({
          uri: MOCK_BUFFER_GRAPHQL_URL,
          fetch: trackingFetch,
        }),
      ),
      cache: new InMemoryCache(),
    })

    const first = client.query({ query: TEST_QUERY })
    const second = client.query({ query: TEST_QUERY })

    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([first, second])

    expect(maxInFlight).toBe(1)
  })
})
