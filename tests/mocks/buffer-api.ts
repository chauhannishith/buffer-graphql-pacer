import { http, HttpResponse } from 'msw'

/** Mock Buffer GraphQL endpoint used in tests only. */
export const MOCK_BUFFER_GRAPHQL_URL = 'https://graph.buffer.com/graphql'

/** Rolling window length aligned with burst integration tests. */
export const MOCK_RATE_LIMIT_WINDOW_MS = 10_000

const RATE_LIMIT = 100

/** Timestamps of requests inside the current rolling window. */
const requestTimestamps: number[] = []

const pruneWindow = (now: number): void => {
  const cutoff = now - MOCK_RATE_LIMIT_WINDOW_MS
  while (requestTimestamps.length > 0 && requestTimestamps[0]! <= cutoff) {
    requestTimestamps.shift()
  }
}

const resetAt = (now: number): string => new Date(now + MOCK_RATE_LIMIT_WINDOW_MS).toISOString()

const rateLimitHeaders = (remaining: number, now: number) => ({
  'RateLimit-Limit': String(RATE_LIMIT),
  'RateLimit-Remaining': String(remaining),
  'RateLimit-Reset': resetAt(now),
})

export const bufferApiHandlers = [
  http.post(MOCK_BUFFER_GRAPHQL_URL, () => {
    const now = Date.now()
    pruneWindow(now)

    if (requestTimestamps.length >= RATE_LIMIT) {
      return HttpResponse.json(
        { retryAfter: 5 },
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...rateLimitHeaders(0, now),
          },
        },
      )
    }

    requestTimestamps.push(now)
    const remaining = RATE_LIMIT - requestTimestamps.length

    return HttpResponse.json(
      { data: { ok: true } },
      {
        status: 200,
        headers: rateLimitHeaders(remaining, now),
      },
    )
  }),
]

export function resetBufferApiMockState(): void {
  requestTimestamps.length = 0
}

export function getBufferApiRequestCount(): number {
  return requestTimestamps.length
}

/** Seed the mock window for 429 retry scenarios (test-only). */
export function setBufferApiRequestCount(count: number, now = Date.now()): void {
  resetBufferApiMockState()
  pruneWindow(now)
  for (let i = 0; i < count; i++) {
    requestTimestamps.push(now - (count - i))
  }
}
