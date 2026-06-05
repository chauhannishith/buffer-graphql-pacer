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
import { BufferRateLimiter, createBufferedFetch } from '../src/index'
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

const postQuery = async (url: string, token: string, fetchImpl: typeof fetch): Promise<Response> =>
  fetchImpl(url, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: JSON.stringify({ query: ORG_QUERY }),
  })

const summarize = (responses: Response[]) => ({
  total: responses.length,
  ok: responses.filter((response) => response.status === 200).length,
  throttled: responses.filter((response) => response.status === 429).length,
})

const runUnpaced = async (url: string, token: string): Promise<void> => {
  console.log(`Unpaced: firing ${FLOOD_COUNT} parallel read-only requests`)
  const started = Date.now()
  const responses = await Promise.all(
    Array.from({ length: FLOOD_COUNT }, () => postQuery(url, token, fetch)),
  )
  console.log({ elapsedMs: Date.now() - started, ...summarize(responses) })
}

const runPaced = async (url: string, token: string): Promise<void> => {
  const limiter = new BufferRateLimiter()
  const bufferedFetch = createBufferedFetch(limiter)

  const work = async (): Promise<Response[]> =>
    Promise.all(Array.from({ length: FLOOD_COUNT }, () => postQuery(url, token, bufferedFetch)))

  if (USE_DASHBOARD) {
    await runPacedWork(limiter, work, {
      dashboard: true,
      title: 'BUFFER RATE OPTIMIZER',
      itemLabel: 'Requests',
    })
    return
  }

  console.log(`Paced: scheduling ${FLOOD_COUNT} read-only requests through the limiter`)
  const started = Date.now()
  const responses = await work()
  console.log({
    elapsedMs: Date.now() - started,
    ...summarize(responses),
    limiterState: limiter.getState(),
  })
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
