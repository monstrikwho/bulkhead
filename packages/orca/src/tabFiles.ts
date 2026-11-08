import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { promisify } from 'node:util'

import {
  CONSOLE_EXTENSION,
  formatConsoleFile,
  parseConsoleFile,
  TABLE_EXTENSION,
  type ConnectionProfile,
  type ExplorerNode,
  type TableFile,
} from '@bulkhead/core'

import type { OrcaWorker } from './orcaApi'

/**
 * Orca shows a plugin's editor tab only for a file inside a workspace (`editor.open` takes a
 * workspace id and a relative path). Consoles and table tabs therefore live in a folder of the
 * plugin's own data directory, which is added to Orca once as a folder workspace named after it.
 * Nothing is ever written into the user's projects.
 */
export const TABS_FOLDER = 'Bulkhead'

export interface Workspace {
  id: string
  path: string
}

interface WorkspaceEntry {
  id: string
  path: string
  hostId: string | null
}

/** Adds a folder to Orca as a folder workspace. */
export type AddFolder = (path: string) => Promise<void>

/**
 * The Bulkhead workspace, added to Orca the first time it is needed. Idempotent: an existing
 * workspace on the folder is reused, so later calls add nothing.
 */
export async function tabsWorkspace(
  host: OrcaWorker['host'],
  folder: string,
  addFolder: AddFolder,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Workspace> {
  await mkdir(folder, { recursive: true })
  const path = await realpath(folder)
  const find = async () => {
    const { workspaces } = (await host.call('workspace.list')) as { workspaces: WorkspaceEntry[] }
    return findWorkspace(workspaces, path)
  }
  const existing = await find()
  if (existing) return existing
  await addFolder(path)
  // Orca lists the new workspace once its store has it; that can take a moment.
  for (let attempt = 0; attempt < 20; attempt++) {
    const added = await find()
    if (added) return added
    await wait(100)
  }
  throw new Error(`Orca did not list the Bulkhead workspace (${path}) after adding it.`)
}

export function findWorkspace(workspaces: WorkspaceEntry[], path: string): Workspace | undefined {
  // Orca names this machine `local` (older builds: null); another host has other files.
  const found = workspaces.find(
    (workspace) =>
      (workspace.hostId === null || workspace.hostId === 'local') &&
      trimSeparator(workspace.path) === trimSeparator(path),
  )
  return found && { id: found.id, path }
}

const trimSeparator = (path: string) => (path.endsWith(sep) ? path.slice(0, -1) : path)

/**
 * Adds the folder through Orca's own CLI: the plugin API opens workspaces but cannot create one.
 * The CLI ships inside the app bundle the worker runs from; elsewhere it is `orca` on PATH.
 */
export function orcaCliAddFolder(execPath = process.execPath): AddFolder {
  const cli = orcaCli(execPath)
  return async (path) => {
    await promisify(execFile)(cli, ['repo', 'add', '--path', path, '--kind', 'folder', '--json'], {
      timeout: 15_000,
    })
  }
}

export function orcaCli(execPath: string): string {
  const bundle = /^(.*?\.app)\/Contents\//.exec(execPath)?.[1]
  return bundle ? `${bundle}/Contents/Resources/bin/orca` : 'orca'
}

/** A file name from a connection or table name: readable on the tab, safe on every system. */
export function fileName(name: string): string {
  const safe = name
    .replace(/[^\p{L}\p{N}._ ()[\]-]+/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  return safe || 'connection'
}

async function write(workspace: Workspace, relative: string, content: string): Promise<void> {
  const path = join(workspace.path, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

/**
 * The connection's console, created on first use and kept afterwards: it is the user's scratch
 * SQL. A different connection with the same name gets its own file.
 */
export async function consoleFile(
  workspace: Workspace,
  profile: ConnectionProfile,
): Promise<string> {
  const base = fileName(profile.name)
  for (const name of [base, `${base}-${profile.id.slice(0, 8)}`]) {
    const relative = `${name}${CONSOLE_EXTENSION}`
    const text = await readFile(join(workspace.path, relative), 'utf8').catch(() => undefined)
    if (text === undefined) {
      await write(
        workspace,
        relative,
        formatConsoleFile({ connectionId: profile.id, sql: '' }, profile.name),
      )
      return relative
    }
    if (parseConsoleFile(text).connectionId === profile.id) return relative
  }
  throw new Error(`Another console file already uses the name of "${profile.name}".`)
}

/** A table tab, rewritten on every open so it shows what the tree knows now. */
export async function tableFile(
  workspace: Workspace,
  profile: ConnectionProfile,
  node: ExplorerNode,
): Promise<string> {
  const schema = node.context?.schema
  const title = schema ? `${schema}.${node.label}` : node.label
  const folder = ['tables', `${fileName(profile.name)}-${profile.id.slice(0, 8)}`]
  if (node.database) folder.push(fileName(node.database))
  // The tab shows only the file name: the connection in it tells two tables of one name apart.
  const relative = `${folder.join('/')}/${fileName(`${title} (${profile.name})`)}${TABLE_EXTENSION}`
  const file: TableFile = {
    bulkhead: 'table',
    connectionId: profile.id,
    title,
    ...(node.database ? { database: node.database } : {}),
    ...(node.previewQuery ? { query: node.previewQuery } : {}),
    ...(node.previewNotice ? { notice: node.previewNotice } : {}),
  }
  await write(workspace, relative, `${JSON.stringify(file, null, 2)}\n`)
  return relative
}
