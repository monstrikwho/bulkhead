# Security policy

Bulkhead holds database credentials and is meant to be pointed at production systems, so we
take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through
[GitHub Security Advisories](https://github.com/monstrikwho/bulkhead/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge
reports within 3 working days and to agree on a disclosure date with you.

## Scope

Especially interesting:

- any way to write through a connection in read-only mode (see
  [docs/read-only-mode.md](docs/read-only-mode.md) for what is and is not promised);
- credentials leaking out of SecretStorage — into settings, logs, the webview or telemetry;
- script injection into the results webview from database content.

## Supported versions

Until 1.0, only the latest release receives fixes.
