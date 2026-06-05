# buffer-graphql-pacer

Open-source **batching and pacing proxy** for [Buffer](https://buffer.com/)’s GraphQL API. Queue bursty traffic, stay under the rolling **100 requests / 15 minutes** limit, and recover from HTTP 429 without half-finished bulk jobs.

![Live terminal dashboard — paced read-only flood against the Buffer GraphQL API](./docs/buffer.gif)

## The problem

Agencies, AI pipelines, and cron scripts often fire 100+ GraphQL calls in seconds. Buffer responds with **HTTP 429** on a **rolling** window—not a fixed `sleep(60)` interval. Scripts crash mid-run; posts are half-scheduled; local state drifts from Buffer.

## The solution

```mermaid
flowchart LR
  subgraph before [Without pacer]
    B1[Burst 500 requests] --> B2[429 at request 101]
    B2 --> B3[Script crashes]
  end

  subgraph after [With buffer-graphql-pacer]
    A1[Burst 500 requests] --> A2[FIFO queue + token bucket]
    A2 --> A3[Steady pace + header sync]
    A3 --> A4[429 pause and retry]
    A4 --> A5[All work completes]
  end
```

| Signal                  | Behavior                                                     |
| ----------------------- | ------------------------------------------------------------ |
| Token bucket            | Proactive pace (~90 req / 15 min with default safety margin) |
| `RateLimit-*` headers   | Slow down when `Remaining` is low                            |
| HTTP 429 + `retryAfter` | Pause queue, retry automatically                             |

## Install

```bash
pnpm add buffer-graphql-pacer
# or: npm install buffer-graphql-pacer
```

Requires **Node.js 20+** (24 recommended for local dev — see `.nvmrc`).

## Quick start

### `fetch` (recommended — full header + 429 handling)

```typescript
import { BufferRateLimiter, createBufferedFetch } from 'buffer-graphql-pacer'

const limiter = new BufferRateLimiter()

const response = await createBufferedFetch(limiter)('https://graph.buffer.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: `{ organizations { id name } }`,
  }),
})

console.log(limiter.getState())
```

### graphql-request

```typescript
import { GraphQLClient } from 'graphql-request'
import { BufferRateLimiter, createGraphqlRequestFetch } from 'buffer-graphql-pacer'

const limiter = new BufferRateLimiter()
const client = new GraphQLClient(url, { fetch: createGraphqlRequestFetch(limiter) })

await client.request(`{ organizations { id name } }`)
```

### Apollo Client

```typescript
import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client/core'
import { BufferRateLimiter, createBufferedFetch } from 'buffer-graphql-pacer'

const limiter = new BufferRateLimiter()

const client = new ApolloClient({
  link: new HttpLink({
    uri: 'https://graph.buffer.com/graphql',
    fetch: createBufferedFetch(limiter),
  }),
  cache: new InMemoryCache(),
})
```

For queue-only pacing without wrapping `fetch`:

```typescript
import { BufferPacingLink } from 'buffer-graphql-pacer/apollo'
```

## API surface

| Export                      | Purpose                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `BufferRateLimiter`         | `schedule(fn)` — core queue + pacing                                                        |
| `createBufferedFetch`       | Drop-in paced `fetch`                                                                       |
| `createGraphqlRequestFetch` | `GraphQLClient` `fetch` option                                                              |
| `BufferPacingLink`          | Apollo link (`buffer-graphql-pacer/apollo`)                                                 |
| `getState()`                | `queueDepth`, tokens, `pausedUntil`, `rateLimitRemaining`, `requestBuckets`, `pacingStatus` |

Defaults match Buffer’s documented limit: **100 requests / 15 minutes**, **0.9 safety margin**.

### Transient failure retries

`BufferRateLimiter` retries flaky work automatically:

| Failure                        | Behavior                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Network error (`fetch` throws) | Up to 3 retries with exponential backoff; **token refunded** (request never reached Buffer) |
| HTTP 5xx                       | Same backoff retries (request reached the server)                                           |
| HTTP 4xx (except 429)          | Fail fast — no retry                                                                        |
| HTTP 429                       | Global pause + retry (unchanged)                                                            |

Buffer mutations may not be idempotent — use retries cautiously on write operations, or disable with `maxTransientRetries: 0`.

## Terminal dashboard (opt-in)

The core limiter (`createBufferedFetch`, `BufferRateLimiter`) **never** shows a terminal UI. The dashboard is a separate optional layer — **disabled by default**.

```typescript
import { BufferRateLimiter, createBufferedFetch } from 'buffer-graphql-pacer'
import { runPacedWork } from 'buffer-graphql-pacer/tui'

const limiter = new BufferRateLimiter()
const fetch = createBufferedFetch(limiter)

// dashboard: false (default) — silent pacing for production scripts
await runPacedWork(limiter, () => scheduleAllPosts(fetch), { dashboard: false })

// dashboard: true — terminal UI for local dev or demos
await runPacedWork(limiter, () => scheduleAllPosts(fetch), {
  dashboard: true,
  title: 'BUFFER RATE OPTIMIZER',
  itemLabel: 'Posts',
})
```

```bash
# MSW demo (no API token — great for GIFs)
pnpm example:dashboard
FLOOD_COUNT=80 pnpm example:dashboard

# Live read-only with dashboard (example script uses DASHBOARD=1)
RUN_LIVE_TESTS=1 DASHBOARD=1 pnpm example:live:readonly
```

The equalizer bars spike during bursts and flatten when `RateLimit-Remaining` is low or the limiter pauses on HTTP 429.

## Testing strategy

| Tier                   | Tool                         | When                                   |
| ---------------------- | ---------------------------- | -------------------------------------- |
| **1 — CI / TDD**       | MSW mock in `pnpm test`      | Every commit; finishes in seconds      |
| **2 — Live read-only** | `pnpm example:live:readonly` | Manual; harmless `organizations` query |
| **3 — Live Ideas**     | `pnpm example:live:ideas`    | Optional; `createIdea` scratchpad only |

**Do not** soak-test with post/draft mutations on live channels.

```bash
# CI-safe (no network)
pnpm test

# Local demo (uses your URL if set — see examples)
pnpm example:paced

# Live read-only flood (consumes real quota)
cp .env.example .env   # set BUFFER_ACCESS_TOKEN, BUFFER_GRAPHQL_URL, RUN_LIVE_TESTS=1
pnpm example:live:readonly   # npm script passes --env-file=.env to tsx
FLOOD_MODE=unpaced pnpm example:live:readonly   # expect 429s
FLOOD_MODE=paced pnpm example:live:readonly       # limiter absorbs burst
DASHBOARD=1 pnpm example:live:readonly          # paced + terminal UI
```

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md).

## License

MIT — see [LICENSE](./LICENSE).
