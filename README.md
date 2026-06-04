# buffer-graphql-pacer

Open-source **batching and pacing proxy** for [Buffer](https://buffer.com/)’s GraphQL API. Queues bursty traffic, respects the rolling **100 requests / 15 minutes** limit, and recovers cleanly from HTTP 429 responses.

> **Status:** Phase 0 — project scaffolding. Core limiter logic ships in follow-up PRs.

## Why this exists

Bulk schedulers (agencies, AI pipelines, cron jobs) often fire 100+ GraphQL calls in seconds. Buffer returns `429 Too Many Requests` on a rolling window—not a fixed interval—so naive `sleep()` loops fail and leave posts half-scheduled.

This library will pace requests using `RateLimit-*` headers and `retryAfter`, keeping scripts reliable without touching live channel queues during development.

## Development

```bash
pnpm install
pnpm test        # Vitest smoke tests
pnpm typecheck
pnpm lint
pnpm build
```

Copy `.env.example` to `.env` only when running **manual** live integration scripts (documented in a later PR). CI never uses real API credentials.

## Documentation

- [Implementation & testing plan](./docs/IMPLEMENTATION_PLAN.md)

## License

MIT — see [LICENSE](./LICENSE).
