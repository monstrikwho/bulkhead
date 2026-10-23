# Read-only mode

A connection marked **production** (or `readOnly`) runs in read-only mode until the user unlocks
writes. Read-only mode is defence in depth: each layer must hold even if the others are
bypassed, so no layer is ever relaxed because another one exists.

## PostgreSQL

| #   | Layer                                                                                                                                                                                                                                                                                                                 | What it stops                                                                                                                                                        | Where                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | **Client check.** Each statement is classified from its tokens; only plain reads pass (`SELECT`, `WITH` without data-modifying parts, `VALUES`, `TABLE`, `SHOW`, `EXPLAIN` without `ANALYZE` of a write). `SELECT … INTO` and `FOR UPDATE/SHARE` count as writes; `SET`, `RESET` and transaction control are refused. | Obvious writes, with a readable message before anything reaches the server.                                                                                          | `core/src/safety`                |
| 2   | **One statement per read-only transaction.** Each statement is sent alone through the extended protocol (which rejects multiple commands) inside `BEGIN READ ONLY … ROLLBACK`.                                                                                                                                        | Writes the classifier cannot see (`SELECT f()` where `f` writes, `nextval`), smuggled `COMMIT; DELETE …`, and settings: anything a statement changes is rolled back. | `driver-postgres/src/session.ts` |
| 3   | **Session default.** The connection starts with `default_transaction_read_only=on`.                                                                                                                                                                                                                                   | Anything that escapes layer 2, e.g. a future code path that forgets the wrapper.                                                                                     | same                             |
| 4   | **Database role (recommended).** Connect production with a role that has only `SELECT`.                                                                                                                                                                                                                               | Everything above, at the source. Bulkhead cannot do this for you.                                                                                                    | your database                    |

Integration tests in `packages/driver-postgres/test` try each of these bypasses against a real
server.

### Known limits

Read-only transactions do not stop everything that has side effects. Without layer 4 a read-only
connection can still, for example, call `pg_terminate_backend`, `pg_cancel_backend` or
`pg_advisory_lock`, run expensive queries, or reach other servers through `dblink` /
`postgres_fdw` with their own credentials. Use a least-privilege role for production.

## Unlocking

- Production: **Unlock Writes…** asks you to type the connection name.
- Other read-only connections: a modal confirmation.
- The unlock lives in memory and ends when you disconnect or reload the window. The tree, the
  status bar and the results header turn red while it lasts.

## Other databases (planned)

| Database   | Server-side enforcement                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| ClickHouse | `readonly=1` per query/session; `readonly=1` also forbids changing settings.                                     |
| Redis      | Allow-list of read commands; `MULTI`/`EVAL`/`FUNCTION`/`MODULE` refused; ACL user with `+@read` recommended.     |
| RabbitMQ   | Management API reads only; peeking messages via requeue-only get (`ackmode=ack_requeue_true`); publish disabled. |
