# Notes for AI coding agents

Human contributors: everything here is also in [CONTRIBUTING.md](CONTRIBUTING.md).

- pnpm workspace; Node 20.19+. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before proposing
  a change; `pnpm test:integration` needs `pnpm dev:db` first.
- `packages/core` must stay free of `vscode`, Node and DOM APIs: the webview imports it too.
- Internal packages export TypeScript source (`exports: ./src/index.ts`); there is no per-package
  build. esbuild bundles the extension, Vite bundles the webview.
- Read-only mode is enforced in independent layers (`docs/read-only-mode.md`). Never weaken one
  layer because another one exists, and add an integration test that tries to bypass any layer
  you touch.
- Never connect to real databases. Only the local compose stand.
- Do not copy code from GPL or proprietary projects (ADR 0005).
- Style: Prettier (no semicolons, single quotes, width 100), `import type` for types, comments
  explain why rather than what.
