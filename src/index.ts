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
  type PauseReason,
  type PacingStatus,
} from './limiter'

export { RequestMetrics, type RequestMetricsOptions } from './telemetry/request-metrics'

export { parseRetryAfterSeconds, PauseGate } from './backoff/retry-429'
export {
  computeTransientBackoffMs,
  isRetryableServerResponse,
  isTransientNetworkError,
  TRANSIENT_RETRY_DEFAULTS,
  type TransientBackoffOptions,
} from './backoff/retry-transient'
export {
  computeFailureBackoffMs,
  computeQuotaBackoffMs,
  FAILURE_BACKOFF_DEFAULTS,
  isQuotaExhaustionStatus,
  QUOTA_EXHAUSTION_DEFAULTS,
  responseHasGraphqlErrors,
  shouldFailureBackoff,
  type FailureBackoffOptions,
  type QuotaExhaustionBackoffOptions,
} from './backoff/quota-exhaustion'
export {
  parseRateLimitHeaders,
  RateLimitHeaderTracker,
  type RateLimitSnapshot,
} from './headers/rate-limit-state'

export { JobQueue } from './queue/job-queue'
export { TokenBucket, type TokenBucketOptions } from './queue/token-bucket'

export { createBufferedFetch, type BufferedFetchOptions } from './adapters/fetch'
export { createGraphqlRequestFetch } from './adapters/graphql-request'
