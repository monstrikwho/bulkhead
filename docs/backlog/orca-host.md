# Orca host: Bulkhead as an Orca plugin

**Why.** Developers who work in Orca (an agent IDE, not built on VS Code) should get the same
client and the same production safety, and agents running inside Orca should reach Bulkhead over
MCP. ADR 0008 already split the VS Code-free runtime into `packages/host`; Orca becomes a second
host next to `packages/extension`.

**What.**

- `packages/orca`: an Orca plugin, `execution: trusted-worker`.
  - Worker `activate(orca)` implements the host ports: `ProfileStore` on `orca.storage`,
    `SecretStore` on `orca.secrets` (Electron safeStorage, Keychain), `HostUi` through panels and
    notifications, `Localize`.
  - A status bar item keeps the worker running (see facts below) and shows MCP state.
  - The worker serves the same MCP server as VS Code (`packages/host/src/mcp/`) and writes its
    instance file under `~/Library/Application Support/bulkhead-orca/`; the stdio bridge is
    copied next to it. A "Connect an AI agent" command prints or writes the client entry.
- UI: the existing `packages/webview` bundle in an Orca HTML panel, with a shim in place of
  `acquireVsCodeApi` (`orca.plugin.request` / worker `panels.post`) and `--vscode-*` theme
  variables mapped from `--orca-*`. Connection tree and results as panels; SQL runs from a custom
  editor with `priority: "option"` (opt-in toggle) or a `.bhsql` file type.
- Results are paged for both hosts: Orca caps a handler reply at 1 MiB and a worker push at
  256 KiB.
- Release: CI bundles the plugin (esbuild, no `node_modules`, at most 2,000 files / 50 MiB) and
  publishes it to a separate repository with `orca-plugin.json` at its root, because a Git
  install cannot point at a monorepo subdirectory.

**Facts from the spike (Orca 1.4.253, 08.11.2026).** Spike code: branch `spike/orca-plugin`,
worktree `../bulkhead-orca-spike`, `packages/orca/`.

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
- Whether the webview bundle needs any change for the Orca CSP beyond the messaging shim.
- Publishing: a catalog entry in the community catalog, or Git install from the separate repo.
