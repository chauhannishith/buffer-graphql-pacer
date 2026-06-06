export type LiveBufferConfig = {
  token: string
  graphqlUrl: string
}

export const OFFICIAL_BUFFER_GRAPHQL_URL = 'https://api.buffer.com'

export const requireLiveTests = (): void => {
  if (process.env.RUN_LIVE_TESTS !== '1') {
    console.error(
      'Live Buffer API examples are disabled. Set RUN_LIVE_TESTS=1 in .env and run via pnpm example:live:* (scripts load .env automatically).',
    )
    process.exit(1)
  }
}

export const getLiveBufferConfig = (): LiveBufferConfig => {
  requireLiveTests()

  const token = process.env.BUFFER_ACCESS_TOKEN?.trim()
  const graphqlUrl = process.env.BUFFER_GRAPHQL_URL?.trim()

  if (!token || !graphqlUrl) {
    console.error(
      'BUFFER_ACCESS_TOKEN and BUFFER_GRAPHQL_URL must be set in .env (use pnpm example:live:* so the script loads it).',
    )
    process.exit(1)
  }

  if (graphqlUrl.includes('graph.buffer.com')) {
    console.warn(
      'BUFFER_GRAPHQL_URL points at graph.buffer.com (Buffer web app). API keys use https://api.buffer.com — see Buffer API docs.',
    )
  }

  if (token.startsWith('Bearer ')) {
    console.warn(
      'BUFFER_ACCESS_TOKEN should be the raw key only — Authorization: Bearer is added automatically.',
    )
  }

  return { token, graphqlUrl }
}

export const buildAuthHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})
