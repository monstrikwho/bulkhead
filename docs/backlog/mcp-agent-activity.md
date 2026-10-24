# MCP: show agent activity

**Why.** Once agents can read schemas or run queries, the user should see that it is happening
without opening a log.

**What.**

- A status bar item "Agent: 2 calls" while an agent is connected, with a click to the log.
- An output channel `Bulkhead: Agents` with every tool call (tool, connection name, duration,
  never secrets or result rows).
- A command to turn agent access off for this window in one click.
