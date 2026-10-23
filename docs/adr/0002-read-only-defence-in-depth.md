# 0002. Read-only mode is defence in depth

Status: accepted · 2026-10-23

## Context

The main reason this project exists is to make production connections safe. A client-side SQL
parser alone can be fooled (functions with side effects, dialect corner cases, multi-statement
scripts). A server-side setting alone can be switched off by the user's own SQL
(`SET default_transaction_read_only = off`, `BEGIN READ WRITE`).

## Decision

Enforce read-only mode in independent layers, each sufficient against the attacks it targets:
a strict client allow-list classifier, one statement per read-only transaction rolled back after
use, and a read-only session default. Document the remaining gaps and recommend a least-privilege
role. A session's access mode is immutable; unlocking creates a new session.

## Consequences

- Clear, early error messages for the common case, without trusting the parser for safety.
- In read-only mode a user cannot hold a transaction open across statements — acceptable for
  production browsing.
- Every driver must state how it enforces read-only on the server side, with integration tests
  that attempt bypasses.
