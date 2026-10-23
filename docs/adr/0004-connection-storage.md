# 0004. Connections in settings, secrets in SecretStorage

Status: accepted · 2026-10-23

## Context

Users want connections on every machine without an account of ours, and secrets must never be
stored in plain text or synced through settings.

## Decision

- Profiles live in the user setting `bulkhead.connections` (scope `application`), so VS Code
  Settings Sync carries them. Validation with zod; invalid entries are shown, never dropped.
- Passwords and keys go to `SecretStorage` keyed by profile id. They are not synced: on a new
  machine the user enters each password once.
- The connection's "writes unlocked" state lives only in memory.

## Consequences

- No backend, no account, nothing to breach on our side.
- Settings can be edited by hand; the extension must tolerate and report broken entries.
- Per-workspace (team) connection files are a possible later addition, read-only by default.
