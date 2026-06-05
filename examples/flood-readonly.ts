/**
 * Tier 2 live test: hammer a harmless read-only query to exercise rate limits.
 *
 * - unpaced: ~110 parallel calls (expect HTTP 429 on the real API)
 * - paced: same count through BufferRateLimiter (expect no surfaced 429)
 *
 * Run:
 *   RUN_LIVE_TESTS=1 pnpm example:live:readonly
 *   RUN_LIVE_TESTS=1 FLOOD_MODE=unpaced pnpm example:live:readonly
 *   RUN_LIVE_TESTS=1 DASHBOARD=1 pnpm example:live:readonly
 */
import {
  BufferRateLimiter,
  BatchHaltedError,
  FailureBackoffExhaustedError,
  LimiterAbortedError,
  createBufferedFetch,
} from '../src/index'
import { runPacedWork } from '../src/tui/run-dashboard'
import { buildAuthHeaders, getLiveBufferConfig } from './lib/live-env'

const ORG_QUERY = `
  query GetOrgMetaData {
    organizations {
      id
      name
    }
  }
`

const FLOOD_COUNT = Number(process.env.FLOOD_COUNT ?? 110)
const FLOOD_MODE = (process.env.FLOOD_MODE ?? 'paced') as 'paced' | 'unpaced'
const USE_DASHBOARD = process.env.DASHBOARD === '1'
const FAILURE_MAX_ATTEMPTS = process.env.FAILURE_MAX_ATTEMPTS
  ? Number(process.env.FAILURE_MAX_ATTEMPTS)
  : undefined

const postQuery = async (url: string, token: string, fetchImpl: typeof fetch): Promise<Response> =>
  fetchImpl(url, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: JSON.stringify({ query: ORG_QUERY }),
  })

const summarize = (responses: Response[]) => {
  const byStatus: Record<string, number> = {}

  for (const response of responses) {
    const statusKey = String(response.status)
    byStatus[statusKey] = (byStatus[statusKey] ?? 0) + 1
  }

  return {
    total: responses.length,
    ok: responses.filter((response) => response.status === 200).length,
    throttled: responses.filter((response) => response.status === 429).length,
    byStatus,
  }
}

const runUnpaced = async (url: string, token: string): Promise<void> => {
  console.log(`Unpaced: firing ${FLOOD_COUNT} parallel read-only requests`)
  const started = Date.now()
  const responses = await Promise.all(
    Array.from({ length: FLOOD_COUNT }, () => postQuery(url, token, fetch)),
  )
  console.log({ elapsedMs: Date.now() - started, ...summarize(responses) })
}

const runPaced = async (url: string, token: string): Promise<void> => {
  const limiter = new BufferRateLimiter({
    ...(FAILURE_MAX_ATTEMPTS !== undefined && !Number.isNaN(FAILURE_MAX_ATTEMPTS)
      ? { failureBackoff: { maxFailureAttempts: FAILURE_MAX_ATTEMPTS } }
      : {}),
  })
  const bufferedFetch = createBufferedFetch(limiter)

  const work = async (): Promise<Response[]> => {
    const results = await Promise.allSettled(
      Array.from({ length: FLOOD_COUNT }, () => postQuery(url, token, bufferedFetch)),
    )

    const responses: Response[] = []
    let skipped = 0

    for (const result of results) {
      if (result.status === 'fulfilled') {
        responses.push(result.value)
        continue
      }
      if (
        result.reason instanceof BatchHaltedError ||
        result.reason instanceof LimiterAbortedError ||
        result.reason instanceof FailureBackoffExhaustedError
      ) {
        skipped += 1
        continue
      }
      throw result.reason
    }

    if (skipped > 0) {
      console.warn(`Skipped ${skipped} requests (batch halt, abort, or backoff exhausted)`)
    }

    return responses
  }

  if (!USE_DASHBOARD) {
    console.log(`Paced: scheduling ${FLOOD_COUNT} read-only requests through the limiter`)
  }

  const started = Date.now()
  let responses: Response[] = []

  await runPacedWork(
    limiter,
    async () => {
      responses = await work()
    },
    {
      dashboard: USE_DASHBOARD
        ? {
            title: 'BUFFER RATE OPTIMIZER',
            itemLabel: 'Requests',
          }
        : false,
    },
  )

  if (!USE_DASHBOARD) {
    console.log({
      elapsedMs: Date.now() - started,
      ...summarize(responses),
      limiterState: limiter.getState(),
    })
  }
}

const main = async (): Promise<void> => {
  const { token, graphqlUrl } = getLiveBufferConfig()

  if (!USE_DASHBOARD) {
    console.warn(
      'This consumes your real Buffer API quota. Wait for RateLimit-Reset before re-running.',
    )
  }

  if (FLOOD_MODE === 'unpaced') {
    if (USE_DASHBOARD) {
      console.error('DASHBOARD=1 is only supported with FLOOD_MODE=paced')
      process.exit(1)
    }
    await runUnpaced(graphqlUrl, token)
    return
  }

  if (FLOOD_MODE === 'paced') {
    await runPaced(graphqlUrl, token)
    return
  }

  console.error(`Unknown FLOOD_MODE="${FLOOD_MODE}". Use "paced" or "unpaced".`)
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
