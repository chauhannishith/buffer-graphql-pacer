/**
 * Tier 3 live test (optional): createIdea mutations to observe a real 429.
 * Ideas stay in your Buffer org scratchpad — they do not publish to channels.
 *
 * Requires double opt-in:
 *   RUN_LIVE_TESTS=1 CONFIRM_IDEAS_FLOOD=1 pnpm example:live:ideas
 *
 * Confirm mutation shape against current Buffer GraphQL docs before running.
 */
import { BufferRateLimiter, createBufferedFetch } from '../src/index'
import { buildAuthHeaders, getLiveBufferConfig, requireLiveTests } from './lib/live-env'

const CREATE_IDEA_MUTATION = `
  mutation CreateIdea($input: CreateIdeaInput!) {
    createIdea(input: $input) {
      __typename
    }
  }
`

const FLOOD_COUNT = Number(process.env.FLOOD_COUNT ?? 120)

const main = async (): Promise<void> => {
  requireLiveTests()

  if (process.env.CONFIRM_IDEAS_FLOOD !== '1') {
    console.error('Set CONFIRM_IDEAS_FLOOD=1 to run createIdea flood (writes to your Ideas inbox).')
    process.exit(1)
  }

  const { token, graphqlUrl } = getLiveBufferConfig()
  const limiter = new BufferRateLimiter()
  const bufferedFetch = createBufferedFetch(limiter)

  console.warn(
    `Scheduling ${FLOOD_COUNT} paced createIdea mutations. Verify schema in Buffer docs first.`,
  )

  const started = Date.now()
  const responses = await Promise.all(
    Array.from({ length: FLOOD_COUNT }, (_, index) =>
      limiter.schedule(() =>
        bufferedFetch(graphqlUrl, {
          method: 'POST',
          headers: buildAuthHeaders(token),
          body: JSON.stringify({
            query: CREATE_IDEA_MUTATION,
            variables: {
              input: {
                title: `pacer-live-test-${Date.now()}-${index}`,
                content: 'buffer-graphql-pacer live flood test — safe to delete',
              },
            },
          }),
        }),
      ),
    ),
  )

  const ok = responses.filter((response) => response.status === 200).length
  const throttled = responses.filter((response) => response.status === 429).length

  console.log({
    elapsedMs: Date.now() - started,
    ok,
    throttled,
    limiterState: limiter.getState(),
  })
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
