# 0007. AI agents may test and save connections

Status: accepted · 2026-10-24 · amends [0006](0006-ai-agents-over-mcp.md)

## Context

ADR 0006 let agents only fill in the connection form: the user typed the password and saved.
In practice the user often already gave the agent everything (a `.env` with `DATABASE_URL`, a
password pasted into the chat) and asked it to "add the database". Making them retype the
password and click Save adds a step without adding safety: the agent already holds the value.
The agent also could not tell whether its guess at host, port or SSL mode was right.

## Decision

- **`test_connection`** runs the same throwaway read-only probe as the form's **Test**: for a
  saved connection (`connectionId`), for new values, or for changes before saving. It returns
  the duration and the databases, or the error message.
- **`save_connection`** saves a new connection or changes to a saved one without the form and
  returns its id. It goes through the same code as the form's **Save**
  (`connections/drafts.ts`): the driver validates the options, secrets go to SecretStorage only.
  VS Code shows a notification that an agent added or changed a connection.
- The proposal gains **`secrets`** (`{"password": "…"}`), checked against the driver's secret
  fields; a password inside `connectionString` is used the same way.
- **What stays with the user:** `save_connection` refuses any change that turns off production
  or read-only on a saved connection and points the agent to `configure_connection`, so the
  user confirms it in the form with the red warning. No tool returns a saved secret, runs
  queries or unlocks writes.

## Consequences

- "Connect me to the database from `.env`" is two tool calls, with no step for the user.
- An agent can now add connections the user did not review. They are ordinary profiles: a
  production one is read-only like any other, and the notification says it happened.
- A process of the same OS user that reads the instance file can store connections and
  passwords. That user could already write `settings.json` and their own keychain, so this is
  no new exposure.
- `test_connection` makes the extension host connect to whatever host the agent names; the
  probe is read-only and closes at once.
