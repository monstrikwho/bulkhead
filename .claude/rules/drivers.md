---
paths:
  - 'packages/driver-*/**'
  - 'packages/core/src/driver.ts'
  - 'packages/core/src/catalog.ts'
  - 'packages/core/src/connection.ts'
  - 'packages/extension/src/drivers.ts'
---

# Drivers

A driver implements `Driver` from `packages/core/src/driver.ts` in its own package
`packages/driver-<name>`, and the extension registers it in `packages/extension/src/drivers.ts`.
Steps for a new one: `CONTRIBUTING.md` → "Adding a database type".

## What the driver owns

- `optionFields` — the connection form is generated from them. `section` puts a field under
  Connection (default), Safety (`security`) or Advanced; `description` is the help line.
  Fields `host` and `port` are shown as one "host : port" row.
- `parseOptions` — zod schema with defaults; throws `ConfigError`. It is the final validation
  for settings written by hand and by the form.
- `parseConnectionString` — what users paste (URLs, JDBC, native formats). Return `undefined`
  for strings that are not yours, throw `ConfigError` for yours but malformed, never map an SSL
  mode to a weaker one. Unit-test every format, including percent-encoding and IPv6.
- `connect` — must honour `accessMode` on the server side (see `read-only-safety.md`).
- `listChildren()` without a parent returns the top level; for SQL drivers these are `database`
  nodes, which the form's Test button lists.

## Catalog (`packages/core/src/catalog.ts`)

- An entry with `driver: null` is shown as "Planned". Give it the driver when the driver ships.
- Hosted presets (Supabase, Neon, …) only set defaults and `hosts` suffixes for recognising
  pasted strings. Add a preset only after connecting to that service for real (with the user's
  own test instance, never production data); compatible-but-different engines (CockroachDB,
  YugabyteDB) need their catalog queries checked first.
- Brand marks: `packages/webview/src/brandIcons.ts`, generated from `simple-icons` (CC0); a
  service without a mark gets a monogram. See ADR 0005.

## Testing

- `pnpm dev:db` starts the stand; tests default to
  `postgres://bulkhead:bulkhead@127.0.0.1:55432/bulkhead` (override `BULKHEAD_PG_URL`).
- A new driver adds a service to `dev/docker-compose.yml`, seed data in `dev/<name>/`, and a CI
  job like the PostgreSQL one in `.github/workflows/ci.yml`.
