# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-23

### Added

- Connection form in an editor tab instead of a chain of input boxes: pick a database or a hosted
  PostgreSQL service (Supabase, Neon, TimescaleDB, Amazon RDS, Google Cloud SQL, DigitalOcean,
  Render), or paste a connection string (`postgres://…`, JDBC URL or libpq `key=value`) to fill
  in every field. **Test** connects read-only and lists the databases you can open; production
  connections are marked red right in the form.

## [0.1.0] - 2026-10-23

### Added

- PostgreSQL connections: database → schema → table/view → columns and indexes, with row
  estimates.
- SQL editor integration: run the statement under the cursor (⌘/Ctrl+Enter) or the whole script
  (⌘/Ctrl+Shift+Enter), cancel a running query.
- Results panel with a virtualised grid, multiple result sets, copy as TSV or JSON.
- Production connections: read-only by default, enforced in three independent layers,
  highlighted in the tree, status bar and results; writes unlock only by typing the connection
  name and lock again on disconnect.
- Connections in user settings (synced by Settings Sync), passwords in SecretStorage.

[Unreleased]: https://github.com/monstrikwho/bulkhead/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/monstrikwho/bulkhead/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/monstrikwho/bulkhead/releases/tag/v0.1.0
