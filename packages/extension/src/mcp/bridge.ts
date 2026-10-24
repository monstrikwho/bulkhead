/**
 * `dist/mcp-bridge.js`: the stdio MCP server agents outside VS Code start (Claude Code, Cursor,
 * Codex …). It holds no logic and no secrets of its own: every message goes to the HTTP server
 * of the Bulkhead window found by `discovery.ts`. The extension copies this file next to the
 * instance files in its global storage, a path that survives extension updates.
 *
 * Runs on VS Code's own runtime (`ELECTRON_RUN_AS_NODE=1`), so the user needs no Node install.
 * stdout carries protocol messages only.
 */
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { chooseInstance, readInstances } from './discovery'
import { relay } from './relay'

const instances = join(__dirname, 'instances')
const cwd = process.cwd()
const pending = new Set<Promise<unknown>>()

createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on('line', (line) => {
    if (!line.trim()) return
    const task = relay(line, () => chooseInstance(readInstances(instances), cwd))
      .then((replies) => {
        for (const reply of replies) process.stdout.write(`${reply}\n`)
      })
      .catch((error: unknown) => process.stderr.write(`bulkhead bridge: ${String(error)}\n`))
      .finally(() => pending.delete(task))
    pending.add(task)
  })
  .on('close', () => {
    void Promise.allSettled(pending).then(() => process.exit(0))
  })
