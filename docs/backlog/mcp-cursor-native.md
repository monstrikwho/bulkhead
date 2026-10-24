# MCP: native registration in Cursor

**Why.** Cursor users now copy an `mcp.json` entry from **Connect an AI Agent…**. Cursor has
its own extension API for registering MCP servers, which would make that step unnecessary.

**What.**

- Register the window's server through Cursor's API when it exists, like the VS Code provider
  in `mcp/agentAccess.ts`.
- Try it in a real Cursor before listing Cursor as "works without setup" anywhere (CLAUDE.md
  rule 6).
