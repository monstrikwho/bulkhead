# 0010. Orca host: sidebar tree, editor tabs in a Bulkhead workspace

Status: accepted · 2026-11-08

## Context

ADR 0008 made the runtime host-agnostic; `packages/orca` is the second host, an Orca plugin with
a trusted Node worker. The UI had to fit Orca's plugin surfaces (Orca 1.4.253, host API 1.4):

- A panel (`contributes.panels`) lives only in the right sidebar; it has no placement option.
  A sidebar is too narrow for a SQL console and a result grid.
- A tab in the main editor area exists only for a custom editor on a file, opened with
  `host.call('editor.open', { workspaceId, path })`. `path` must be relative to that workspace:
  absolute paths and `..` are refused.
- The plugin API does not tell which workspace is focused: `workspace.readContext` gives a
  display name and branch, and two repositories on `main` are both called `main`.
- The plugin API can list and open workspaces but cannot create one.

Writing console files into the focused project was tried and rejected: it puts files into
someone else's git tree (shared with other sessions), and picking the project by name and
branch guessed wrong.

## Decision

- **Sidebar panel = the connection tree** (and the connection form while it is open). Errors
  are a one-line notice there.
- **SQL consoles and table data are custom editors** in the main area: a console is a `.bhsql`
  file (first line `-- bulkhead connection: <id>`, then the SQL), a table tab a `.bhtable` JSON
  file with the connection, database, preview query and notice. Both are rendered by the same
  webview bundle (`data-app="orca-console"`, `"orca-table"`); runs go to the frame that asked.
- **The files live in a workspace of their own**: `bulkhead-orca/Bulkhead` in the plugin's data
  directory, added to Orca as a folder workspace named "Bulkhead" the first time a tab opens.
  The worker finds it again by path, so this is idempotent. Because the plugin API cannot
  create a workspace, the worker runs Orca's own CLI from the app bundle
  (`orca repo add --path … --kind folder`), within the authority of a trusted worker.
- Opening a tab shows the Bulkhead workspace (`workspace.open`), then the file (`editor.open`).

## Consequences

- No Bulkhead file is ever written into a user's project; consoles persist across restarts
  as plain files the user can also open, rename or delete.
- Bulkhead tabs are not next to the tabs of the project the user was in: Orca switches to the
  Bulkhead workspace. If Orca adds a focused-workspace id and a way to open a file outside a
  workspace, tabs can move next to the user's sessions.
- The CLI call depends on the bundle layout (`<App>.app/Contents/Resources/bin/orca`, or `orca`
  on `PATH` elsewhere); a failure is reported to the user with the folder path.
- New capabilities `workspace:read` and `workspace:write` needed a fresh user approval.
