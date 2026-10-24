---
paths:
  - 'packages/webview/**'
  - 'packages/extension/src/webview/**'
  - 'packages/extension/src/results/**'
  - 'packages/extension/src/connections/formPanel.ts'
  - 'packages/core/src/protocol.ts'
  - 'packages/core/src/connectionForm.ts'
  - 'scripts/preview-webview.mjs'
  - 'scripts/preview/**'
---

# Webviews

One Vite bundle (`packages/webview` → `packages/extension/dist/webview/index.{js,css}`) serves
every webview; the host's page sets `<body data-app="results|table|connection-form">` and
`src/main.tsx` renders the matching app. HTML and CSP come from
`packages/extension/src/webview/html.ts`.

## Rules

- Messages are plain JSON, typed in core (`protocol.ts` for results, `connectionForm.ts` for the
  form), and validated on the host before use (`isWebviewToHost`, `isFormWebviewToHost`, then
  zod for drafts). The webview has no access to settings, secrets or the file system.
- Style only with `--vscode-*` theme variables and keep it working in dark, light and high
  contrast themes. Production state is red (`--vscode-errorForeground`) wherever it shows.
- The CSP allows scripts with the nonce and styles/fonts/images from the extension only: no
  CDNs, remote fonts or images, no `eval`. React `style={…}` props are fine.
- New UI text is English for now; keep it short and specific.
- Keyboard: every action reachable by keyboard, visible focus (`--vscode-focusBorder`).

## Verify what you built

`pnpm preview:webview [filter]` builds the bundle, opens every scenario of
`scripts/preview-webview.mjs` in headless Chrome with a mock host (real driver parser, canned
test results), in dark and light themes, and writes `.preview/<scenario>-<theme>.png`. It fails
on any console error. Look at the screenshots yourself before calling UI work done, and add a
scenario for every new state (empty, loading, error, production).

The real host wiring is covered by the VS Code smoke test in CI (`packages/extension/src/test`).
