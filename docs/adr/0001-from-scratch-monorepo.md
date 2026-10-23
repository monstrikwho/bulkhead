# 0001. Write from scratch, monorepo with internal packages

Status: accepted · 2026-10-23

## Context

Existing options: fork the last MIT version of `cweijan/vscode-database-client` (large codebase,
later relicensed, tied to its own UI and premium model), build on SQLTools (SQL-only driver
model, no place for Redis or RabbitMQ, read-only safety not a concept), or start fresh.
DbGate, Beekeeper Studio and DBeaver are standalone apps and mostly GPL — usable for ideas only.

## Decision

Start from scratch with a contract-first design: a `Driver` / `DriverSession` interface that does
not assume SQL (tree nodes are driver-defined), a `Transport` layer independent of drivers, and
read-only mode as a first-class concept of the contract.

Use a pnpm workspace with internal packages (`core`, `driver-*`, `extension`, `webview`) that
export TypeScript source. No per-package build step: esbuild bundles the extension host, Vite
bundles the webview.

## Consequences

- Drivers and core logic are testable without VS Code.
- Boundaries are enforced by package dependencies: the webview cannot import Node code.
- `vsce` runs with `--no-dependencies`, which is fine because everything is bundled.
- We re-implement what a fork would give us for free; the roadmap is staged accordingly.
