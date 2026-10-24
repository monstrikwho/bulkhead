# 0006. AI agents talk to Bulkhead over MCP, through the same safety layers

Status: accepted · 2026-10-24 · amended by [0007](0007-agents-test-and-save-connections.md)
(agents may test and save connections)

## Context

People increasingly let AI agents (GitHub Copilot, Claude Code, Cursor, Codex …) do the setup
work in their editor, including "connect me to the staging database". The Model Context
Protocol (MCP) is what all of them speak. An agent with its own database driver bypasses
everything Bulkhead is for: it holds the password, sees production as just another URL and can
write to it. We would rather give agents a door that keeps the user in charge.

## Decision

- **One local MCP server per VS Code window**, inside the extension host: Streamable HTTP on
  `127.0.0.1`, a random port, a random 256-bit bearer token per window, stateless (no MCP
  sessions). Requests with a foreign `Host` header are refused (DNS rebinding). The setting
  `bulkhead.mcp.enabled` (default on) turns it off.
- **Agents inside VS Code** find it through `vscode.lm.registerMcpServerDefinitionProvider`
  (VS Code 1.101+, looked up at runtime because our minimum version is older).
- **Agents outside VS Code** start a stdio bridge (`dist/mcp-bridge.js`) on VS Code's own
  runtime (`ELECTRON_RUN_AS_NODE=1`), so no Node install is needed. The extension copies it to
  its global storage, a path that survives updates, and writes one instance file per window
  there (`mcp/instances/<pid>.json`, mode 0600) with the port and token. The bridge forwards
  each message to the window whose workspace contains the agent's working directory.
  **Bulkhead: Connect an AI Agent…** prints the `claude mcp add` line or the `mcp.json` entry.
- **Tools only prepare; the user decides.** `list_connections` returns profiles without
  secrets. `configure_connection` validates the agent's values against the driver's option
  fields and opens the ordinary connection form filled in, with a notice that an agent did it,
  the list of changed fields of a saved connection and a red warning when production or
  read-only would be turned off. The agent cannot save, read a saved password, unlock writes or
  run queries. A password the agent passes inside a connection string lands in the form's
  password field and is stored only when the user saves.
- Uses `@modelcontextprotocol/sdk` (MIT). Its dependencies are bundled into `dist/extension.js`;
  the bridge does not import it.

## Consequences

- Setting up a connection with an agent is one tool call plus the user's review, and the result
  is an ordinary profile: production marking, SecretStorage and read-only mode work as always.
- Any process of the same OS user can read the instance file and talk to the server. That is
  no new exposure: the same user can already read `settings.json` with the profiles, and the
  tools can do nothing the user would not see.
- Running queries for an agent is a separate decision (see `docs/backlog/`). It must go through
  `ConnectionManager` sessions and the read-only layers of ADR 0002, with the same integration
  tests that try to bypass them, and an agent must never be able to unlock writes.
- Instance files of crashed windows stay behind; the bridge skips processes that are gone.
- The extension now activates on startup (`onStartupFinished`) so agents find the server
  without the user opening the Bulkhead view first.
