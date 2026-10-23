# AGENTS.md

Entry point for coding agents other than Claude Code (Codex, Gemini CLI, Cursor, …).

All rules and facts about this repository live in [CLAUDE.md](CLAUDE.md). Despite the name it is
for every agent: read it in full before starting. This file does not repeat it.

Also read, before touching the matching code:

| File                                                                   | When                                     |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| [.claude/rules/read-only-safety.md](.claude/rules/read-only-safety.md) | safety classifier, drivers' sessions     |
| [.claude/rules/drivers.md](.claude/rules/drivers.md)                   | drivers, catalog, connection form fields |
| [.claude/rules/webview.md](.claude/rules/webview.md)                   | webviews, their host side and protocols  |
| [.claude/skills/release/SKILL.md](.claude/skills/release/SKILL.md)     | releasing a version                      |

Claude Code formats edited files with Prettier through a hook (`.claude/settings.json`). Without
the hook, run `pnpm format` yourself before finishing.
