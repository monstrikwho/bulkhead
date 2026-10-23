# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
