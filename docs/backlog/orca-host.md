# Orca host: Bulkhead as an Orca plugin

**Why.** Developers who work in Orca (an agent IDE, not built on VS Code) should get the same
client and the same production safety, and agents running inside Orca should reach Bulkhead over
MCP. ADR 0008 split the VS Code-free runtime into `packages/host`; Orca is a second host next to
`packages/extension`.

**Status (08.11.2026).** `packages/orca` works as a development plugin
(`orca plugin dev load packages/orca/dist`); it is not published. Remaining work is below under
**What is left**.

**What shipped.**

- `packages/orca`: an Orca plugin, `execution: trusted-worker`, built by esbuild into `dist/`
  (the plugin folder). The worker implements the host ports: `OrcaProfileStore` on
  `orca.storage` (the same JSON array as VS Code's `bulkhead.connections`), secrets on
  `orca.secrets`, `HostUi` through the panel and notifications, English `t`.
- A status bar item keeps the worker running; the worker serves the same MCP server as VS Code
  and writes its instance file and stdio bridge under
  `~/Library/Application Support/bulkhead-orca/`. **Bulkhead: Connect an AI Agent** gives the
  client entry.
- UI (ADR 0010): the sidebar panel is the connection tree (and the connection form while it is
  open). SQL consoles (`.bhsql`) and table data (`.bhtable`) are custom editors, i.e. tabs in
  the main area. The same `packages/webview` bundle renders all of them, talking to the worker
  through `window.orca` instead of `acquireVsCodeApi`; `--vscode-*` variables are mapped from
  Orca's `--orca-*` tokens.
- Results are paged: Orca caps a handler reply at 1 MiB and a worker push at 256 KiB.
- SSH tunnels work in Orca through the system `ssh` (ADR 0009).

**Workarounds for gaps in Orca's plugin API (Orca 1.4.253, host API 1.4).**

- **No focused workspace id.** `workspace.readContext` returns only `{ branch, displayName,
terminals }`; Orca resolves the active worktree id internally but does not expose it, and two
  repositories on `main` are both named `main`. Bulkhead therefore does not open tabs in the
  user's project at all.
- **Editor tabs only for files inside a workspace.** `editor.open` takes a workspace id and a
  relative path (no absolute path, no `..`). Bulkhead keeps its files in its own folder,
  `bulkhead-orca/Bulkhead`, added to Orca as a folder workspace "Bulkhead".
- **No way to create a workspace from a plugin.** The worker runs Orca's CLI from the app
  bundle, `orca repo add --path <folder> --kind folder`, the first time a tab opens, and finds
  the workspace by path afterwards (idempotent).
- Native `title` tooltips do not show inside plugin frames: the webview draws its own.
- The panel bridge refuses explicit `undefined` values: replies go through a JSON round trip.
- `orca plugin shot --theme` repaints only while Orca's window is hidden; the preview script
  (`pnpm preview:webview orca`) uses sampled Orca tokens for both themes instead.

**What is left.**

- Ask Orca for a focused-workspace id and for opening a file outside a workspace; then tabs can
  sit next to the user's sessions instead of in the Bulkhead workspace.
- Release: CI bundles the plugin (no `node_modules`, at most 2,000 files / 50 MiB) and publishes
  it to a separate repository with `orca-plugin.json` at its root, because a Git install cannot
  point at a monorepo subdirectory.
- An end-to-end check in CI (today: unit tests, the preview script and manual `orca plugin
shot` runs).

**Facts from the spike (Orca 1.4.253, 08.11.2026).**

- The worker is a plain Node 24 child process (`fork(..., { execArgv: [] })`, no permission
  model): outbound TCP to Postgres and a listener on `127.0.0.1` both work inside Orca.
- The bridge runs under `Orca Helper (Plugin)` with `ELECTRON_RUN_AS_NODE=1`; initialize,
  `tools/list` and a tool call passed through it to the worker.
- A worker without hooks or status bar items starts on first use and is stopped after about
  5 idle minutes. With a status bar item it starts when the plugin is enabled (also at Orca
  launch) and is not reaped. After three crashes it stays off until restarted. `deactivate` gets
  2 s before SIGKILL.
- The worker environment is an allowlist (`PATH`, `HOME`, `LANG`, …): no `SSH_AUTH_SOCK`, which
  matters for the SSH transport.
- Panels: CSP allows the plugin's own scripts, no `eval`, no network. Panel ↔ worker messaging
  works; panel messages are capped at 64 KiB.
- MCP servers cannot be declared in the manifest yet; the worker-hosted server plus bridge is the
  way.
- Plugin data lives per plugin key, so a dev copy and an installed copy keep separate profiles.
  No sync across machines, unlike VS Code Settings Sync.
- Every new capability triggers a new user approval.

**Open questions.**

- Default storage for profiles: plugin storage only, or also an importable/exportable file so
  users can move profiles between VS Code and Orca.
- Publishing: a catalog entry in the community catalog, or Git install from the separate repo.
