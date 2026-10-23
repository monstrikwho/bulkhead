#!/usr/bin/env bash
# PostToolUse hook for Edit/Write: formats the edited file with the repository's Prettier, so
# every file an agent touches already matches `pnpm format:check`. Silent; never blocks an edit.

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$file" ] && [ -f "$file" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
case "$file" in
  "$CLAUDE_PROJECT_DIR"/*) ;;
  /*) exit 0 ;;
esac
case "$file" in
  *.ts | *.tsx | *.js | *.mjs | *.cjs | *.json | *.css | *.md | *.yml | *.yaml) ;;
  *) exit 0 ;;
esac
[ -x node_modules/.bin/prettier ] || exit 0
node_modules/.bin/prettier --write --log-level silent --ignore-unknown "$file" >/dev/null 2>&1
exit 0
