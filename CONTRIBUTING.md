# Contributing

Thank you for helping improve **buffer-graphql-pacer**.

## Development setup

```bash
pnpm install
pnpm test
pnpm build
```

Requires **Node.js 20+** (see `.nvmrc`).

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new behavior
- `fix:` — bug fixes
- `test:` — tests only
- `chore:` — tooling, deps, repo hygiene
- `ci:` — GitHub Actions
- `docs:` — documentation

Keep pull requests focused. Prefer several small commits over one large dump.

## Pull request checklist

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass locally
- [ ] Live Buffer API scripts are not enabled in CI (`RUN_LIVE_TESTS` stays off)
- [ ] No secrets or `.env` files committed

## Project layout

See [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) for architecture and phased delivery.
