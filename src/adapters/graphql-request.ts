import type { BufferRateLimiter } from '../limiter'
import { createBufferedFetch } from './fetch'

/**
 * Custom `fetch` for {@link https://github.com/jasonkuhrt/graphql-request graphql-request}'s
 * `GraphQLClient` constructor options.
 *
 * @example
 * ```ts
 * import { GraphQLClient } from 'graphql-request'
 * import { BufferRateLimiter, createGraphqlRequestFetch } from 'buffer-graphql-pacer'
 *
 * const limiter = new BufferRateLimiter()
 * const client = new GraphQLClient(url, { fetch: createGraphqlRequestFetch(limiter) })
 * ```
 */
export function createGraphqlRequestFetch(
  limiter: BufferRateLimiter,
  fetchImpl?: typeof fetch,
): typeof fetch {
  if (fetchImpl) {
    return createBufferedFetch({ limiter, fetch: fetchImpl })
  }
  return createBufferedFetch(limiter)
}
