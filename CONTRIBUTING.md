# Contributing to Bulkhead

Thanks for helping! This guide gets you from clone to a running extension in a few minutes.

## Ground rules

- Be kind; we follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Never use a real production database** for development, tests or bug reports. Use the local
  stand below.
- **Do not copy code from GPL-licensed or proprietary projects** (DBeaver, Beekeeper Studio,
  Antares, DBCode, …). Reading them for ideas is fine; code must be your own or come from a
  permissively licensed source with its notice kept. See
  [ADR 0005](docs/adr/0005-license-hygiene.md).
- For anything bigger than a bug fix, open an issue first so we can agree on the approach.

## Setup

Requirements: Node.js 20.19+ (22 recommended, see `.nvmrc`), pnpm via Corepack, Docker.

```sh
corepack enable
pnpm install
pnpm dev:db        # PostgreSQL with seed data on 127.0.0.1:55432 (user/password: bulkhead)
pnpm build
```

Then open the repository in VS Code and press **F5** (**Run Extension**). In the new window,
add a connection to `127.0.0.1:55432`, database `bulkhead`, user `bulkhead`.

`pnpm watch` rebuilds the extension and the webview on change; reload the dev window
(**Developer: Reload Window**) to pick changes up.

## Commands

| Command                           | What it does                                               |
| --------------------------------- | ---------------------------------------------------------- |
| `pnpm lint`                       | ESLint, type-aware                                         |
| `pnpm typecheck`                  | `tsc` in every package                                     |
| `pnpm test`                       | Unit tests (Vitest)                                        |
| `pnpm test:integration`           | Driver tests against the local stand (`pnpm dev:db` first) |
| `pnpm --filter bulkhead test:e2e` | Smoke test inside a real VS Code (downloads it once)       |
| `pnpm format`                     | Prettier                                                   |
| `pnpm package`                    | Production build and `.vsix` in `packages/extension/`      |

## Repository layout

```
packages/
  core/             driver contracts, SQL splitter, read-only classifier, webview protocol
  driver-postgres/  PostgreSQL driver (node-postgres)
  extension/        VS Code extension host: settings, secrets, tree, commands
  webview/          React results grid, built into extension/dist/webview
dev/                docker compose stands and seed data
docs/               architecture, roadmap, ADRs
```

More in [docs/architecture.md](docs/architecture.md).

## Tests

- Logic without I/O (parsing, classification, policies) gets unit tests next to the code.
- Anything that talks to a database gets an integration test in the driver package, running
  against the compose stand. Read-only mode changes **must** come with tests that try to break
  it, including attempts the client-side check cannot see.
- UI wiring is covered by the VS Code smoke test; keep it fast.

## Commits and pull requests

- Small, focused PRs. One change per PR.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(postgres): show partition tables`, `fix(results): keep scroll on rerun`.
- Add user-visible changes to `CHANGELOG.md` under **Unreleased**.
- CI must be green: format, lint, typecheck, unit, integration and smoke tests.

## Adding a database type

1. Create `packages/driver-<name>` implementing `Driver` from `@bulkhead/core`.
2. Decide how read-only mode is enforced **by the server**, not only by the client, and write
   integration tests that try to get around it.
3. Add the kind to `DRIVER_KINDS`, register the driver in `packages/extension/src/drivers.ts`
   and the `driver` enum in the extension's `package.json`. Give the planned entry in
   `packages/core/src/catalog.ts` its driver, so the connection picker offers it; the form is
   built from the driver's `optionFields`, and `parseConnectionString` makes pasting work.
4. Add a service to `dev/docker-compose.yml` and a CI job.

## Releasing (maintainers)

1. Move **Unreleased** in `CHANGELOG.md` under a version heading and bump `version` in
   `packages/extension/package.json`.
2. Merge, then tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. The `Release` workflow publishes to the VS Code Marketplace and Open VSX and attaches the
   `.vsix` to a GitHub release. It reads two secrets of the `release` environment:
   - `VSCE_PAT`: an Azure DevOps personal access token of a member of the `bulkhead`
     Marketplace publisher, organization **All accessible organizations**, scope
     **Marketplace → Manage**. Global PATs are retired on 1 December 2026, see the roadmap.
     With the repository variable `MARKETPLACE_OIDC` set to `true`, the workflow uses
     Marketplace trusted publishing (`vsce publish --oidc`) instead and needs no token.
   - `OVSX_PAT`: an Open VSX access token of a member of the `bulkhead` namespace; the account
     must have signed the Eclipse Foundation Publisher Agreement.
