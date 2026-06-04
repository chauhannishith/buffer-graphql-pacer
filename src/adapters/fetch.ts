import { BufferRateLimiter } from '../limiter'

export type BufferedFetchOptions = {
  limiter: BufferRateLimiter
  /** Base fetch implementation (defaults to global `fetch`). */
  fetch?: typeof fetch
}

/**
 * Drop-in `fetch` that routes every request through {@link BufferRateLimiter}.
 * Returning a `Response` enables RateLimit header sync and HTTP 429 retry.
 */
export function createBufferedFetch(
  options: BufferRateLimiter | BufferedFetchOptions,
): typeof fetch {
  const { limiter, fetch: baseFetch = globalThis.fetch.bind(globalThis) } =
    options instanceof BufferRateLimiter ? { limiter: options } : options

  return (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> =>
    limiter.schedule(() => baseFetch(input, init))
}
