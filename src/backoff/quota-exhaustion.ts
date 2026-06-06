export const FAILURE_BACKOFF_DEFAULTS = {
  /** 429 uses retryAfter; all other 4xx (including 401) use failure backoff. */
  excludeStatuses: [429] as number[],
  includeGraphqlErrors: true,
  /** After transient 5xx retries are exhausted. */
  includeServerErrors: true,
  baseDelayMs: 5 * 60 * 1000,
  maxDelayMs: 24 * 60 * 60 * 1000,
} as const

/** @deprecated Alias for {@link FAILURE_BACKOFF_DEFAULTS}. */
export const QUOTA_EXHAUSTION_DEFAULTS = FAILURE_BACKOFF_DEFAULTS

export type FailureBackoffOptions = {
  enabled?: boolean
  /** When set, only these statuses trigger backoff (overrides default 4xx rule). */
  statuses?: number[]
  excludeStatuses?: number[]
  includeGraphqlErrors?: boolean
  includeServerErrors?: boolean
  /** Stop remaining queued jobs after the first non-retryable failure (default true). */
  haltBatchOnFirstFailure?: boolean
  /** Max failure backoffs per job before giving up (default: unlimited). */
  maxFailureAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

/** @deprecated Alias for {@link FailureBackoffOptions}. */
export type QuotaExhaustionBackoffOptions = FailureBackoffOptions

export const shouldFailureBackoff = (
  status: number,
  options: FailureBackoffOptions = {},
): boolean => {
  if (options.statuses) {
    return options.statuses.includes(status)
  }

  const exclude = options.excludeStatuses ?? FAILURE_BACKOFF_DEFAULTS.excludeStatuses
  if (exclude.includes(status)) {
    return false
  }

  if (status >= 400 && status < 500) {
    return true
  }

  if (options.includeServerErrors ?? FAILURE_BACKOFF_DEFAULTS.includeServerErrors) {
    return status >= 500 && status < 600
  }

  return false
}

/** @deprecated Use {@link shouldFailureBackoff}. */
export const isQuotaExhaustionStatus = (
  status: number,
  statuses: readonly number[] = [403],
): boolean => statuses.includes(status)

export const computeFailureBackoffMs = (
  attempt: number,
  options: FailureBackoffOptions = {},
): number => {
  const baseDelayMs = options.baseDelayMs ?? FAILURE_BACKOFF_DEFAULTS.baseDelayMs
  const maxDelayMs = options.maxDelayMs ?? FAILURE_BACKOFF_DEFAULTS.maxDelayMs
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
}

/** @deprecated Alias for {@link computeFailureBackoffMs}. */
export const computeQuotaBackoffMs = computeFailureBackoffMs

type GraphqlErrorBody = {
  errors?: Array<{ extensions?: { code?: string } }>
}

export const parseGraphqlErrorCode = async (response: Response): Promise<string | null> => {
  try {
    const body = (await response.clone().json()) as GraphqlErrorBody
    const code = body.errors?.[0]?.extensions?.code
    return typeof code === 'string' ? code : null
  } catch {
    return null
  }
}

export const responseHasGraphqlErrors = async (response: Response): Promise<boolean> => {
  try {
    const body = (await response.clone().json()) as GraphqlErrorBody
    return Array.isArray(body.errors) && body.errors.length > 0
  } catch {
    return false
  }
}
