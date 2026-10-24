import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** Where the MCP server of a window answers. */
export const MCP_PATH = '/mcp'

/**
 * How the stdio bridge finds a running Bulkhead. Every VS Code window runs its own extension
 * host and MCP server, and writes one file here with the port and token. The bridge picks the
 * window whose workspace contains the agent's working directory, so the form opens where the
 * user is looking. Shared by the extension and the bridge: Node only, no `vscode`.
 */
export interface McpInstance {
  pid: number
  port: number
  /** Bearer token of that server. The file is readable by the user only. */
  token: string
  workspaceFolders: string[]
  startedAt: number
}

export function writeInstance(dir: string, instance: McpInstance): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, `${instance.pid}.json`), JSON.stringify(instance), { mode: 0o600 })
}

export function removeInstance(dir: string, pid: number): void {
  rmSync(join(dir, `${pid}.json`), { force: true })
}

export function readInstances(dir: string): McpInstance[] {
  let files: string[]
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'))
  } catch {
    return []
  }
  return files.flatMap((file) => {
    try {
      const value: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      return isInstance(value) ? [value] : []
    } catch {
      // Half-written or removed while reading: the next request reads it again.
      return []
    }
  })
}

/**
 * The window for an agent started in `cwd`: the deepest workspace folder containing it, else
 * the most recently started window. Windows whose process is gone are skipped.
 */
export function chooseInstance(
  instances: readonly McpInstance[],
  cwd: string,
  alive: (pid: number) => boolean = isAlive,
): McpInstance | undefined {
  let best: { instance: McpInstance; depth: number } | undefined
  for (const instance of instances) {
    if (!alive(instance.pid)) continue
    const depth = Math.max(
      -1,
      ...instance.workspaceFolders.map((folder) => (contains(folder, cwd) ? folder.length : -1)),
    )
    if (
      !best ||
      depth > best.depth ||
      (depth === best.depth && instance.startedAt > best.instance.startedAt)
    ) {
      best = { instance, depth }
    }
  }
  return best?.instance
}

function contains(folder: string, path: string): boolean {
  const inside = relative(resolve(folder), resolve(path))
  return !inside.startsWith('..') && !isAbsolute(inside)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isInstance(value: unknown): value is McpInstance {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.pid === 'number' &&
    typeof entry.port === 'number' &&
    typeof entry.token === 'string' &&
    typeof entry.startedAt === 'number' &&
    Array.isArray(entry.workspaceFolders) &&
    entry.workspaceFolders.every((folder) => typeof folder === 'string')
  )
}
