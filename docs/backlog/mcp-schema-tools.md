# MCP: schema tools for agents

**Why.** Agents writing SQL or code against a database guess table and column names. Bulkhead
already lists them in the tree.

**What.**

- `list_databases`, `list_tables`, `describe_table` (columns, types, indexes, foreign keys) for a
  saved connection, built on `DriverSession.listChildren` and `ExplorerNode`.
- Uses the existing session of the connection, or opens one read-only. Never asks for a
  password on its own: if the session needs one, the tool answers that the user must connect
  first.

**Open questions.**

- Should production connections be visible to agents at all, or only after a per-connection
  opt-in (`agentAccess: true` on the profile)?
