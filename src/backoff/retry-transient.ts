export const TRANSIENT_RETRY_DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
} as const

export type TransientBackoffOptions = {
  baseDelayMs?: number
  maxDelayMs?: number
  /** Inject for tests; defaults to Math.random. */
  random?: () => number
}

/**
 * Exponential backoff with jitter for transient network or server failures.
 * `attempt` is zero-based (0 = first retry after initial failure).
 */
export const computeTransientBackoffMs = (
  attempt: number,
  options: TransientBackoffOptions = {},
): number => {
  const baseDelayMs = options.baseDelayMs ?? TRANSIENT_RETRY_DEFAULTS.baseDelayMs
  const maxDelayMs = options.maxDelayMs ?? TRANSIENT_RETRY_DEFAULTS.maxDelayMs
  const random = options.random ?? Math.random

  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
  const jitter = random() * exponential * 0.25
  return Math.floor(exponential + jitter)
}

const TRANSIENT_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'])

/**
 * True when `fetch` (or similar) failed before an HTTP response was received.
 */
export const isTransientNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  if (error.name === 'AbortError') {
    return false
  }

  if (error instanceof TypeError) {
    return true
  }

  const code = (error as NodeJS.ErrnoException).code
  if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) {
    return true
  }

  return error.message.toLowerCase().includes('fetch failed')
}

/** HTTP 5xx responses that may succeed on retry. */
export const isRetryableServerResponse = (response: Response): boolean =>
  response.status >= 500 && response.status < 600
