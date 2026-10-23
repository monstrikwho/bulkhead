# 0005. License hygiene

Status: accepted · 2026-10-23

## Context

Bulkhead is MIT. Several projects in this space are GPL (DBeaver, Beekeeper Studio, Antares SQL,
DbGate) or proprietary (DBCode: its public repository holds docs and prebuilt binaries only, and
its license forbids reverse engineering). Copying their code would force a relicense or infringe.

## Decision

- No code from GPL-, AGPL- or proprietary-licensed projects. Studying their behaviour, docs and
  screenshots for ideas is fine.
- Code from MIT/BSD/Apache projects may be adapted with the original notice kept in the file
  and the source linked.
- Runtime dependencies must be MIT, BSD, ISC or Apache-2.0; anything else needs an ADR.
- Brand marks of databases and hosted services (the connection picker) come from
  [Simple Icons](https://simpleicons.org) (CC0-1.0), copied into
  `packages/webview/src/brandIcons.ts` with the version noted. They are trademarks of their
  owners and are used only to say which database a connection is for, never as Bulkhead's own
  branding. A brand that asks us to remove its mark gets a monogram instead.

## Consequences

Reviewers check provenance for large or unusually polished contributions.
