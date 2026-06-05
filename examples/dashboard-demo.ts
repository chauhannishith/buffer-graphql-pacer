/**
 * MSW-backed terminal dashboard demo (no real API token required).
 *
 * Run: pnpm example:dashboard
 *      FLOOD_COUNT=80 pnpm example:dashboard
 */
import { setupServer } from 'msw/node'
import { BufferRateLimiter, createBufferedFetch } from '../src/index'
import { runPacedWork } from '../src/tui/run-dashboard'
import { bufferApiHandlers, MOCK_BUFFER_GRAPHQL_URL } from '../tests/mocks/buffer-api'

const FLOOD_COUNT = Number(process.env.FLOOD_COUNT ?? 50)

const server = setupServer(...bufferApiHandlers)

const main = async (): Promise<void> => {
  server.listen({ onUnhandledRequest: 'error' })

  const limiter = new BufferRateLimiter({
    maxRequests: 100,
    windowMs: 10_000,
    safetyMargin: 1,
    lowWatermark: 0,
  })
  const bufferedFetch = createBufferedFetch(limiter)

  await runPacedWork(
    limiter,
    async () => {
      await Promise.all(
        Array.from({ length: FLOOD_COUNT }, () =>
          bufferedFetch(MOCK_BUFFER_GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: '{ organizations { id name } }' }),
          }),
        ),
      )
    },
    { dashboard: true, title: 'BUFFER RATE OPTIMIZER', itemLabel: 'Requests' },
  )

  server.close()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
