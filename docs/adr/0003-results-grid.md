# 0003. Results grid: TanStack Virtual over a DOM grid

Status: accepted · 2026-10-23

## Context

Candidates: Glide Data Grid (canvas, fast, theming through a JS theme object, slow release
cadence), AG Grid Community (feature-rich, large bundle, own theming system), SlickGrid, and
TanStack Table/Virtual (headless).

## Decision

Render a plain DOM grid virtualised with `@tanstack/react-virtual`. Rows are positioned
absolutely; only visible rows are mounted.

## Consequences

- VS Code theme variables, focus outlines and accessibility roles work without adapters.
- Small bundle (~80 kB gzipped with React).
- Editing, column resizing and range selection are ours to build (stage 0.3). If that work
  outgrows a hand-written grid, revisit Glide Data Grid behind the same props.
