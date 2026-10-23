---
paths:
  - 'packages/core/src/safety/**'
  - 'packages/core/src/sql/**'
  - 'packages/driver-*/src/session.ts'
  - 'packages/extension/src/connections/manager.ts'
  - 'docs/read-only-mode.md'
---

# Read-only mode

The reason Bulkhead exists. A production (or `readOnly`) connection must not be able to change
data until the user unlocks writes by typing the connection name. Full description:
`docs/read-only-mode.md`.

## Layers (PostgreSQL)

1. `checkReadOnly` (core) classifies every statement from its tokens; only plain reads pass.
   Unknown statements count as writes.
2. Each statement runs alone through the extended protocol inside `BEGIN READ ONLY … ROLLBACK`.
3. The session starts with `default_transaction_read_only=on`.
4. Recommended to users: a database role with `SELECT` only.

## Rules

- Never relax a layer because another one exists. A layer that "can't matter" is the one that
  saves us when another has a bug.
- The access mode of a session never changes in place: unlock or lock means a new session
  (`ConnectionManager.setAccessMode`). A user disconnect drops the unlock.
- Anything that only inspects (tree, test connection, metadata) opens read-only sessions, even
  for development connections. `ConnectionManager.probe` is always read-only.
- When the classifier is unsure, it says "write". False refusals are acceptable; false passes
  are bugs.
- Every change here comes with integration tests in `packages/driver-*/test/` that try to get a
  write through: smuggled statements, writes inside functions, `set_config`, sequences,
  `SELECT … INTO`, `FOR UPDATE`, comments and quoting tricks. Look at the existing tests first.
- Unit tests for the classifier live in `packages/core/src/safety/policy.test.ts`; add a case
  for every new statement form.
- Planned drivers enforce read-only on the server too (ClickHouse `readonly=1`, Redis command
  allow-list + ACL, RabbitMQ management reads only); a client-side check alone is not enough.
