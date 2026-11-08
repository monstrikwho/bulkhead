# Architecture

```
┌──────────────────────── VS Code ────────────────────────┐
│ Extension host (Node)                    Webview (DOM)  │
│ ┌──────────────────────────────┐        ┌─────────────┐ │
│ │ packages/extension           │ JSON   │ packages/   │ │
│ │  ConnectionStore  (settings) │◄──────►│ webview     │ │
│ │  SecretStorage · HostUi impl │protocol│ React grid  │ │
│ │  ConnectionTreeProvider      │        └─────────────┘ │
│ │  EditorBindings · panels     │                        │
│ └──────────────┬───────────────┘                        │
│                │ ports: ProfileStore, SecretStore,      │
│                │ HostUi, ResultsTarget, Localize        │
│ ┌──────────────┴───────────────┐                        │
│ │ packages/host                │                        │
│ │  ConnectionManager · drafts  │                        │
│ │  SecretVault · QueryRunner   │                        │
│ │  AgentAccess · MCP server    │                        │
│ └──────────────┬───────────────┘                        │
└────────────────┼────────────────────────────────────────┘
                 │ Driver / DriverSession (packages/core)
      ┌──────────┴──────────┐
      │ driver-postgres     │  … driver-clickhouse, driver-redis, driver-rabbitmq
      └──────────┬──────────┘
                 │ Transport: direct today; ssh, kubectl port-forward next
                 ▼
             database
```

Another editor host (Orca, next) replaces `packages/extension` with its own adapter over the same
`packages/host`.

## Packages

| Package                     | Runs in        | Depends on              | Role                                                                                                                                |
| --------------------------- | -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@bulkhead/core`            | host + webview | `zod`                   | Contracts (`Driver`, `DriverSession`, `ExplorerNode`, `Transport`), SQL lexer/splitter, read-only classifier, host↔webview protocol |
| `@bulkhead/driver-postgres` | host           | core, `pg`, `pg-cursor` | PostgreSQL: tree, execution, read-only enforcement on the server side                                                               |
| `@bulkhead/host`            | host (Node)    | core, drivers, MCP SDK  | The runtime every editor host shares: sessions, drafts, secrets vault, query runs, MCP server and bridge (ADR 0008)                 |
| `bulkhead` (extension)      | host           | core, host              | Everything that touches the VS Code API, plus the VS Code implementations of the host ports                                         |
| `@bulkhead/webview`         | webview        | core (types), React     | Results UI                                                                                                                          |

`core` must not import `vscode`, Node or DOM APIs: it is shared by both sides and is the place
for logic that deserves unit tests. `host` may use Node but not `vscode` (ESLint refuses the
import): whatever it needs from the editor comes in through the ports in `host/src/ports.ts`.
Internal packages export TypeScript source; esbuild bundles the extension into one CommonJS
file, Vite bundles the webview into `extension/dist/webview`.
The VSIX ships no `node_modules` and no native modules, so one package works on every platform.

## Host ports

`@bulkhead/host` never calls an editor API; a host adapter passes these in (VS Code's are in
`extension/src/hostPorts.ts`, `connections/store.ts` and `results/`):

| Port            | What the runtime asks                                                          | VS Code                                           |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `ProfileStore`  | list, get, save, remove profiles; change event                                 | `ConnectionStore` over `bulkhead.connections`     |
| `SecretStore`   | get, set, delete by key; only `SecretVault` uses it and owns the key format    | `context.secrets` (SecretStorage)                 |
| `HostUi`        | ask for a missing secret, confirm an unlock, open the connection form, notices | input boxes, modal dialogs, `ConnectionFormPanel` |
| `ResultsTarget` | reveal, post `run-*` messages                                                  | `ResultsView`, `TablePanel`                       |
| `Localize`      | `t(message, ...args)` for user-facing strings                                  | `vscode.l10n.t`                                   |

Plain values come in as options: the row limit (`maxRows()`), the MCP storage directory, the
built bridge, the version and the open folders.

## Key flows

**Connecting.** `ConnectionManager.session(profile)` (host) parses driver options, reads secrets
from `SecretVault` (asking once through `HostUi.askSecret` if missing), opens the transport, then
calls `driver.connect` with the transport's local endpoint and the current access mode. Sessions are
cached per profile and dropped when the profile changes (a fingerprint of driver, transport, options
and mode).

**Access mode.** Starts from the profile (`production` / `readOnly`). **Unlock Writes…**
(`unlockWrites`, only after `HostUi.confirmUnlock`) and **Lock Writes** set an in-memory override
and reconnect: a session's mode never changes in place. A user disconnect clears the override, so
production returns read-only.

**Running SQL.** The extension's `EditorRunner` takes the selection, or the statement under the
cursor (`pickStatement` in host, with the core splitter), and hands it to the host's
`QueryRunner`, which calls `session.execute`. Drivers split scripts themselves, run
statements one by one, stop at the first error, and return one `StatementOutcome` per statement.
Results go to a `ResultsTarget` as `run-started` / `run-finished` messages: the `ResultsView`
in the bottom panel for editors, or a `TablePanel` (an editor tab per table, opened by
**Open Data**) for tree actions. One run at a time per target.

**Webview protocol.** Plain JSON messages typed in `core/src/protocol.ts`. The host keeps the
messages of the last run and replays them when the webview (re)loads and reports `ready`.
Messages from the webview are validated with `isWebviewToHost` before use. The start screen
of the results panel sends `action` messages from a fixed list (`welcomeActions`); the host maps
each to a command or a link, so the webview cannot run arbitrary commands.

**Connection form.** `bulkhead.connection.add` and `.edit` open `ConnectionFormPanel`, a webview in
the editor area rendered by the same bundle as the results (the page's `data-app` picks the app).
The picker lists `core/src/catalog.ts`: drivers and hosted presets of them. The form is built from
the driver's `optionFields` and talks to the host with the messages in
`core/src/connectionForm.ts`: `parse` (the drivers' `parseConnectionString`), `test` (a
throwaway read-only session that lists databases) and `save`. The webview never writes settings
or secrets; the host validates the draft with the driver and saves it.

**AI agents (MCP).** `AgentAccess` (`host/src/mcp/agentAccess.ts`) starts `mcp/server.ts`, a
stateless MCP server on `127.0.0.1` with a per-window token, copies the bridge and writes an
instance file for `mcp/bridge.ts`, the stdio bridge agents outside VS Code start (ADR 0006). The
extension's `mcp/agentAccess.ts` follows `bulkhead.mcp.enabled`, registers the server with VS Code's
MCP provider API and runs **Connect an AI Agent…**. Every tool turns the agent's values into a draft
with `proposeDraft` (`core/src/agent.ts`). `configure_connection` opens the connection form through
`HostUi.openConnectionForm`, marked as filled in by an agent; `test_connection` and
`save_connection` pass it to `host/src/connections/drafts.ts`, the code behind the form's Test and
Save (ADR 0007). `save_connection` refuses drafts that turn off production or read-only.

## Storage

| What                        | Where                                              | Synced          |
| --------------------------- | -------------------------------------------------- | --------------- |
| Connection profiles         | user setting `bulkhead.connections`                | Settings Sync   |
| Passwords, keys             | `SecretStorage` (`bulkhead.connection.<id>.<key>`) | no, per machine |
| Editor → connection binding | `workspaceState`                                   | no              |
| Writes unlocked             | memory only                                        | no              |
| MCP port and token          | `globalStorage/mcp/instances/<pid>.json`, mode 600 | no              |

## Extending

- **New database:** implement `Driver` in a new package — see CONTRIBUTING.
- **New transport:** add a variant to `transportConfigSchema` and a `Transport` implementation
  returning a local endpoint; drivers need no changes. Implementations that need Node (`ssh2`,
  spawning `kubectl`) live in `host` or a dedicated package, not in `core`.
- **New editor host:** implement the ports of `host/src/ports.ts` and wire `@bulkhead/host`
  like `extension/src/extension.ts` does (ADR 0008).
- **New tree action:** expose data on `ExplorerNode` (e.g. `previewQuery`) rather than having the
  extension know driver internals.
