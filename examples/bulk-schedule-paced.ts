/**
 * Demo: burst GraphQL calls through the paced fetch adapter (MSW in tests, or set BUFFER_GRAPHQL_URL).
 *
 * Run: pnpm example:paced
 */
import { BufferRateLimiter, createBufferedFetch } from '../src/index'

const GRAPHQL_URL = process.env.BUFFER_GRAPHQL_URL ?? 'https://graph.buffer.com/graphql'
const BURST_SIZE = Number(process.env.BURST_SIZE ?? 25)

const main = async (): Promise<void> => {
  const limiter = new BufferRateLimiter()
  const bufferedFetch = createBufferedFetch(limiter)

  console.log(`Scheduling ${BURST_SIZE} paced requests to ${GRAPHQL_URL}`)

  const started = Date.now()
  const results = await Promise.all(
    Array.from({ length: BURST_SIZE }, () =>
      bufferedFetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ organizations { id name } }' }),
      }),
    ),
  )
  const elapsed = Date.now() - started

  const ok = results.filter((response) => response.status === 200).length
  const throttled = results.filter((response) => response.status === 429).length

  console.log({
    elapsedMs: elapsed,
    ok,
    throttled,
    limiterState: limiter.getState(),
  })
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
