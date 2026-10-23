## What and why

<!-- What does this change, and what problem does it solve? Link the issue: Closes #123 -->

## How it was tested

<!-- Unit tests, integration tests against the local stand, manual steps in the dev host. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] Changes that touch a database path have integration tests (`pnpm test:integration`)
- [ ] Changes to read-only mode keep every layer independent (see `docs/read-only-mode.md`)
- [ ] User-visible changes are listed under **Unreleased** in `CHANGELOG.md`
