# MCP: read-only queries for agents

**Why.** "How many orders failed yesterday?" is the most common thing an agent wants from a
database. Without Bulkhead it does that with its own driver and full write access.

**What.**

- `run_query(connectionId, sql, database?)` that always runs **read-only**, whatever the
  connection's current mode: a dedicated read-only session, never the user's unlocked one.
- All layers of ADR 0002 apply; results are capped by `bulkhead.query.maxRows` and returned as
  compact JSON or Markdown.
- Integration tests that try to write through the tool, including bypasses the client-side
  classifier cannot see (functions with side effects, `SET` tricks, multi-statement scripts).
- The results show in the Results panel too, so the user sees what the agent ran.

**Open questions.**

- Per-connection opt-in, or a confirmation per query for production?
- Should writes ever be possible for development connections? If yes, only with a
  confirmation in VS Code per statement; never for production.
