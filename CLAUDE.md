# Bulkhead — guide for coding agents

Bulkhead is an open-source (MIT) database client for VS Code whose core feature is production
safety: a production connection is read-only until the user deliberately unlocks it, and it looks
different everywhere. Published as `bulkhead.bulkhead` on the VS Code Marketplace and Open VSX.
This file is the single source of rules for every agent (Claude Code, Codex, Cursor, …);
`AGENTS.md` points here. Humans: the same facts live in `CONTRIBUTING.md` and `docs/`.

Read before larger work: `docs/architecture.md`, `docs/read-only-mode.md`, `docs/roadmap.md`,
`docs/adr/`. Path-scoped rules in `.claude/rules/` load automatically when you touch matching
files; other agents read them before editing those areas.

## Map

```
packages/core/             contracts and pure logic, shared by host and webview (zod only)
  src/driver.ts              Driver, DriverSession, OptionField, ExplorerNode, StatementOutcome
  src/connection.ts          ConnectionProfile schema (the bulkhead.connections setting)
  src/catalog.ts             what the "new connection" picker offers: drivers + hosted presets
  src/connectionForm.ts      host <-> connection form webview messages, ConnectionDraft
  src/protocol.ts            host <-> results webview messages
  src/safety/                read-only classifier and policy
  src/sql/                   lexer and statement splitter (Postgres/ClickHouse quoting)
packages/driver-postgres/  node-postgres driver: session, explorer, options, connection strings
packages/extension/        everything that touches the VS Code API
  src/extension.ts           activation, commands
  src/connections/           store (settings), secrets (SecretStorage), manager (sessions),
                             formPanel (connection form webview panel)
  src/explorer/tree.ts       connection tree
  src/query/                 editor bindings, query runner
  src/results/               results webview view
  src/webview/html.ts        shared webview HTML + CSP
  src/test/                  VS Code smoke test (mocha, runs in a real VS Code)
packages/webview/          React apps for both webviews, one bundle; body[data-app] picks the app
  src/App.tsx, ResultGrid.tsx  results
  src/connectionForm/          picker + form
  src/brandIcons.ts            vendored Simple Icons marks (generated, do not hand-edit)
scripts/                   release helpers, webview preview (screenshots)
dev/                       docker compose stand: PostgreSQL 17 on 127.0.0.1:55432
docs/                      architecture, read-only mode, roadmap, ADRs
```

## Commands

| Command                                    | What                                                               |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `pnpm lint` / `pnpm typecheck`             | ESLint (type-aware) / `tsc` in every package                       |
| `pnpm test`                                | unit tests (Vitest), fast                                          |
| `pnpm dev:db` then `pnpm test:integration` | driver tests against the local PostgreSQL stand                    |
| `pnpm preview:webview [filter]`            | screenshots of webview states, dark + light → `.preview/*.png`     |
| `pnpm format` / `pnpm format:check`        | Prettier                                                           |
| `pnpm build` / `pnpm package`              | dev build / production build + `.vsix` in `packages/extension/`    |
| `pnpm --filter bulkhead test:e2e`          | VS Code smoke test — **opens a visible VS Code window**, see below |

Before saying a change is done: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`,
plus `pnpm test:integration` for driver changes and `pnpm preview:webview` for UI changes. Check
each command's exit code; do not judge by grepping one line of the output.

## Non-negotiable rules

1. **Never connect to a real database.** Only the local compose stand (`pnpm dev:db`). This
   includes "just a quick SELECT" against anything that is not a local container.
2. **Read-only mode is defence in depth** (`docs/read-only-mode.md`). Never relax one layer
   because another exists. Any change near the guard, the session wrapper or the session
   settings comes with an integration test that tries to bypass it, including bypasses the
   client-side check cannot see.
3. **`packages/core` stays pure**: no `vscode`, Node or DOM APIs. The webview imports it.
4. **Secrets only in SecretStorage** (`SecretVault`). Never in settings, logs, error messages,
   test fixtures or screenshots. The webview never writes settings or secrets: it sends a
   draft, the host validates it with the driver and saves.
5. **License hygiene** (ADR 0005): no code from GPL/AGPL/proprietary projects (DBeaver,
   Beekeeper, Antares, DbGate, DBCode …). Ideas and screenshots are fine. Runtime deps must be
   MIT/BSD/ISC/Apache-2.0.
6. **Do not promise what does not work.** The picker lists only drivers that exist and hosted
   services the driver was tried against; everything else is "Planned" and disabled.
7. **No visible windows.** Browsers and Playwright run headless. The e2e smoke test launches a
   real VS Code window that steals focus: CI runs it on every push; run it locally only when
   the user agrees.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`: use
  `import type`. Prettier: no semicolons, single quotes, width 100.
- Comments explain why, not what. Match the density of the surrounding code.
- Internal packages export TS source (`exports: ./src/index.ts`); no per-package build.
- User-facing strings in the extension go through `vscode.l10n.t`.
- Webview UI uses only VS Code theme variables (`--vscode-*`), so it fits every theme. The CSP
  allows no external resources: no CDN, no remote fonts or images.
- Tests: logic without I/O → unit test next to the code (`*.test.ts`); anything that talks to a
  database → `packages/driver-*/test/*.integration.test.ts`; UI wiring → smoke test.
- Conventional Commits (`feat(postgres): …`, `fix(results): …`). User-visible changes go to
  `CHANGELOG.md` under **Unreleased**. Update `docs/roadmap.md`, `docs/architecture.md` and an
  ADR when the change touches them.

## Recipes

- **New database driver:** `CONTRIBUTING.md` → "Adding a database type", and
  `.claude/rules/drivers.md`.
- **New transport (SSH, kubectl):** `docs/architecture.md` → "Extending".
- **Release:** skill `.claude/skills/release/SKILL.md`.
- **Check UI:** `pnpm preview:webview`, then open the PNGs in `.preview/`. A new UI state gets a
  scenario in `scripts/preview-webview.mjs`.

## Gotchas learned the hard way

- TypeScript is pinned to `~6.0`: typescript-eslint does not support 7 yet. Vitest 4 and vsce 3
  because Vitest 5 / vsce 4 need Node 22 and local Node is 20.
- Vitest's unit project must exclude `packages/extension/src/test/**`: those mocha tests import
  `vscode` and only run inside VS Code.
- `.vscodeignore` is a blacklist on purpose: `!` negations win over excludes and once shipped
  test output in the VSIX. Check `unzip -l packages/extension/*.vsix` after packaging changes.
- `@vscode/test-electron` needs a short `--user-data-dir` on macOS (103-char socket path limit);
  `scripts/run-e2e.mjs` handles it. `.vscode-test/` is ~300 MB: keep it out of Prettier/ESLint.
- Webview panels appear in `vscode.window.tabGroups` asynchronously, with view type
  `mainThreadWebview-<viewType>`; tests must wait for them.
- Node reports a refused `localhost` as an `AggregateError` with an empty message (IPv6 and IPv4
  attempts). Use `describeError` from `connections/formPanel.ts` for user-facing errors.
- `brandIcons.ts` is generated from the `simple-icons` package (version in its header); very dark
  brand colours are drawn with the theme foreground so they stay visible.

## Publishing state

- VS Code Marketplace publisher `bulkhead`; Open VSX namespace `bulkhead`, ownership verified
  (EclipseFdn/open-vsx.org#14643).
- Releases: tag `v<version>` → `.github/workflows/release.yml`, environment `release` (required
  reviewer, tags `v*` only), secrets `VSCE_PAT` and `OVSX_PAT`.
- **Deadline:** global Azure DevOps PATs stop working on 1 December 2026. Before that, move
  Marketplace publishing to Microsoft Entra ID (`vsce publish --azure-credential` with GitHub
  OIDC) — tracked in `docs/roadmap.md`.
