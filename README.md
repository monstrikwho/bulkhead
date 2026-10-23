# Bulkhead

**An open-source database client for VS Code, with production safety built in.**

[![CI](https://github.com/monstrikwho/bulkhead/actions/workflows/ci.yml/badge.svg)](https://github.com/monstrikwho/bulkhead/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A bulkhead is the watertight wall inside a ship's hull: one breach doesn't sink the whole
vessel. Bulkhead the extension does the same for your databases — a production connection is
read-only until you deliberately unlock it, and it never looks like your laptop's dev database.

> **Status: early preview.** PostgreSQL works today. ClickHouse, Redis, RabbitMQ, SSH tunnels
> and `kubectl port-forward` are next — see the [roadmap](docs/roadmap.md).

## Why another database client?

- **Free, with no catches.** No limit on connections, no "Premium only" features, no account.
  MIT-licensed, forever.
- **Production safety is the core, not a setting.** Mark a connection as production and it
  becomes read-only, enforced in [three independent layers](docs/read-only-mode.md), and
  shown in red everywhere: tree, status bar, results.
- **Your editor's sync, not ours.** Connections live in your VS Code user settings, so Settings
  Sync carries them. Passwords stay in the OS keychain via VS Code SecretStorage.
- **Works where you work:** VS Code, Cursor, VSCodium and other editors built on VS Code (via
  Open VSX).

## Features

| Area              | Today                                                                            |
| ----------------- | -------------------------------------------------------------------------------- |
| Connections       | PostgreSQL, direct                                                               |
| Explorer          | databases → schemas → tables and views (with row estimates) → columns, indexes   |
| SQL               | run statement under cursor (⌘/Ctrl+Enter) or script (⌘/Ctrl+Shift+Enter), cancel |
| Results           | virtualised grid for large results, several result sets, copy as TSV/JSON        |
| Production safety | read-only by default, typed confirmation to unlock, relocks on disconnect        |

## Getting started

1. Install **Bulkhead** from the
   [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=bulkhead.bulkhead) or
   [Open VSX](https://open-vsx.org/extension/bulkhead/bulkhead), or search for `bulkhead.bulkhead`
   in the Extensions view.
2. Open the **Bulkhead** view in the activity bar and choose **Add Connection**.
3. Pick **Production** for anything you must not break.
4. Click the **New Query** icon on a connection, write SQL, press **⌘/Ctrl+Enter**.

## Production safety in one paragraph

A production connection opens read-only. Every statement is checked before it is sent and only
plain reads pass; it then runs alone inside `BEGIN READ ONLY … ROLLBACK`, on a session that
starts with `default_transaction_read_only=on`. So a `DELETE` hidden in a script, a
`SET default_transaction_read_only = off`, or a write hidden inside a function called from a
`SELECT` are all refused. To write, use **Unlock Writes…** and type the connection's name; writes
stay unlocked until you disconnect. For the strongest guarantee, also connect production with a
database role that has no write privileges — Bulkhead's layers and the role add up.
Details: [docs/read-only-mode.md](docs/read-only-mode.md).

## Contributing

Bug reports, ideas and pull requests are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md).
The architecture is described in [docs/architecture.md](docs/architecture.md) and the key
decisions in [docs/adr](docs/adr). Please report security issues privately, see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Bulkhead contains no code from GPL-licensed or proprietary database clients;
see [ADR 0005](docs/adr/0005-license-hygiene.md).
