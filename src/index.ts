/**
 * Buffer GraphQL rate-limit pacing proxy.
 */

export const PACKAGE_NAME = 'buffer-graphql-pacer' as const

export {
  BUFFER_RATE_LIMIT_DEFAULTS,
  BufferRateLimiter,
  type BufferRateLimiterCallbacks,
  type BufferRateLimiterOptions,
  type BufferRateLimiterState,
  type PacingStatus,
} from './limiter'

export { RequestMetrics, type RequestMetricsOptions } from './telemetry/request-metrics'

export { parseRetryAfterSeconds, PauseGate } from './backoff/retry-429'
export {
  parseRateLimitHeaders,
  RateLimitHeaderTracker,
  type RateLimitSnapshot,
} from './headers/rate-limit-state'

export { JobQueue } from './queue/job-queue'
export { TokenBucket, type TokenBucketOptions } from './queue/token-bucket'

export { createBufferedFetch, type BufferedFetchOptions } from './adapters/fetch'
export { createGraphqlRequestFetch } from './adapters/graphql-request'
