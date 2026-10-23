# Architecture

```
┌──────────────────────── VS Code ────────────────────────┐
│ Extension host (Node)                    Webview (DOM)  │
│ ┌──────────────────────────────┐        ┌─────────────┐ │
│ │ packages/extension           │ JSON   │ packages/   │ │
│ │  ConnectionStore  (settings) │◄──────►│ webview     │ │
│ │  SecretVault  (SecretStorage)│protocol│ React grid  │ │
│ │  ConnectionManager           │        └─────────────┘ │
│ │  ConnectionTreeProvider      │                        │
│ │  EditorBindings · QueryRunner│                        │
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

## Packages

| Package                     | Runs in        | Depends on              | Role                                                                                                                                |
| --------------------------- | -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@bulkhead/core`            | host + webview | `zod`                   | Contracts (`Driver`, `DriverSession`, `ExplorerNode`, `Transport`), SQL lexer/splitter, read-only classifier, host↔webview protocol |
| `@bulkhead/driver-postgres` | host           | core, `pg`, `pg-cursor` | PostgreSQL: tree, execution, read-only enforcement on the server side                                                               |
| `bulkhead` (extension)      | host           | core, drivers           | Everything that touches the VS Code API                                                                                             |
| `@bulkhead/webview`         | webview        | core (types), React     | Results UI                                                                                                                          |

`core` must not import `vscode`, Node or DOM APIs: it is shared by both sides and is the place
for logic that deserves unit tests. Internal packages export TypeScript source; esbuild bundles
the extension into one CommonJS file, Vite bundles the webview into `extension/dist/webview`.
The VSIX ships no `node_modules` and no native modules, so one package works on every platform.

## Key flows

**Connecting.** `ConnectionManager.session(profile)` parses driver options, reads secrets from
`SecretVault` (asking once if missing), opens the transport, then calls `driver.connect` with
the transport's local endpoint and the current access mode. Sessions are cached per profile and
dropped when the profile changes (a fingerprint of driver, transport, options and mode).

**Access mode.** Starts from the profile (`production` / `readOnly`). **Unlock Writes…** and
**Lock Writes** set an in-memory override and reconnect: a session's mode never changes in
place. A user disconnect clears the override, so production returns read-only.

**Running SQL.** `QueryRunner` takes the selection, or the statement under the cursor (found
with the core splitter), and calls `session.execute`. Drivers split scripts themselves, run
statements one by one, stop at the first error, and return one `StatementOutcome` per statement.
Results go to `ResultsView` as `run-started` / `run-finished` messages.

**Webview protocol.** Plain JSON messages typed in `core/src/protocol.ts`. The host keeps the
messages of the last run and replays them when the webview (re)loads and reports `ready`.
Messages from the webview are validated with `isWebviewToHost` before use.

## Storage

| What                        | Where                                              | Synced          |
| --------------------------- | -------------------------------------------------- | --------------- |
| Connection profiles         | user setting `bulkhead.connections`                | Settings Sync   |
| Passwords, keys             | `SecretStorage` (`bulkhead.connection.<id>.<key>`) | no, per machine |
| Editor → connection binding | `workspaceState`                                   | no              |
| Writes unlocked             | memory only                                        | no              |

## Extending

- **New database:** implement `Driver` in a new package — see CONTRIBUTING.
- **New transport:** add a variant to `transportConfigSchema` and a `Transport` implementation
  returning a local endpoint; drivers need no changes. Implementations that need Node (`ssh2`,
  spawning `kubectl`) live in the extension or a dedicated package, not in `core`.
- **New tree action:** expose data on `ExplorerNode` (e.g. `previewQuery`) rather than having the
  extension know driver internals.
