# 0008. A host-agnostic runtime behind ports

Status: accepted · 2026-11-08

## Context

Bulkhead is going to run in a second host besides VS Code: Orca, an Electron IDE for agents.
Orca plugins get a trusted Node worker but no `vscode` API. Until now everything that ran on
the host side lived in `packages/extension`, so sessions, the read-only access mode, drafts,
query runs and the MCP server were tangled with `vscode.window`, `vscode.workspace` and
`vscode.EventEmitter`. A second host would have had to copy that code, and with it the safety
logic: two copies of the code that keeps production read-only drift apart.

## Decision

- **New package `@bulkhead/host`**: Node is allowed, `vscode` is not (ESLint
  `no-restricted-imports`). `core` stays pure. It holds `ConnectionManager`, `SecretVault`, the
  draft code behind the connection form (`connections/drafts.ts`), `unlockWrites`, the
  host-agnostic `QueryRunner` and `pickStatement`, the driver registry, and the whole MCP side:
  `AgentAccess` (server lifecycle, bridge copy, instance file, tools), the server, the relay,
  discovery and the stdio bridge.
- **Ports** in `host/src/ports.ts`, each only as wide as the runtime calls it:
  `ProfileStore`, `SecretStore`, `HostUi`, `ResultsTarget` and `Localize`. Plain values (row
  limit, storage directory, bridge path, version, open folders) are options, not ports.
- **`SecretVault` stays the only way to secrets** and owns the key format
  `bulkhead.connection.<id>.<key>`; a `SecretStore` is a bare key-value store. Existing users
  keep their passwords.
- **The extension keeps** what is VS Code by nature: activation and commands, the tree, editor
  bindings, webviews and their HTML, the connection form panel, the MCP provider registration,
  the `bulkhead.mcp.enabled` setting and **Connect an AI Agent…**, plus thin port
  implementations (`hostPorts.ts`, `ConnectionStore`).
- User-facing strings in host go through the injected `t`; VS Code passes `vscode.l10n.t`, and
  the strings did not change.
- `dist/mcp-bridge.js` is still built by the extension (from `host/src/mcp/bridge.ts`) and
  copied to the same place in global storage, so agent configs keep working.

## Consequences

- An Orca adapter implements five small interfaces and gets the same sessions, read-only mode,
  drafts and MCP tools as VS Code, with no copy of the safety code.
- The production unlock confirmation is a port method that `unlockWrites` always calls, so a
  new host cannot unlock without asking; how it asks (VS Code: typing the name) is the host's.
- A host emits events through a small `Emitter` of its own; the extension bridges to
  `vscode.EventEmitter` where VS Code needs its full `Event` signature (the MCP provider).
- Some agent-facing texts (tool replies, server instructions) still say "VS Code". They are
  part of the MCP contract and were kept; a second host decides whether to word them per host.
- `@vscode/l10n-dev export` looks for `vscode.l10n.t(...)` calls; strings that moved to host are
  now `t(...)` calls and need the extraction pattern extended once bundles are introduced.
