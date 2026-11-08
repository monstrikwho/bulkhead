import type { DriverKind } from './connection'
import type { ExplorerNode } from './driver'
import type { AccessMode } from './safety/policy'

/**
 * Messages between a panel-style host (Orca: one HTML panel with the connection list, a query
 * box and the results) and its worker. The results and the connection form inside the panel
 * still speak `protocol.ts` and `connectionForm.ts`, carried on `PANEL_WEBVIEW`. Plain JSON only;
 * the worker validates every input, the panel is not trusted with decisions.
 */

/** Request and event names (`orca.plugin.request` / `orca.panels.post`). */
export const PANEL = {
  /** Request and event: a results or form message (see `packages/webview/src/orca/bridge.ts`). */
  webview: 'bulkhead.webview',
  /** Request: one page of a large pushed message. */
  page: 'bulkhead.page',
  state: 'bulkhead.state',
  children: 'bulkhead.children',
  connection: 'bulkhead.connection',
  newConnection: 'bulkhead.newConnection',
  run: 'bulkhead.run',
  prompt: 'bulkhead.prompt',
  agentSetup: 'bulkhead.agentSetup',
  /** Request: open the connection's SQL console in an editor tab. */
  openConsole: 'bulkhead.openConsole',
  /** Request: open a table's data in an editor tab. */
  openTable: 'bulkhead.openTable',
  /** Events. */
  changed: 'bulkhead.on.changed',
  view: 'bulkhead.on.view',
  ask: 'bulkhead.on.ask',
  /** A question was answered (in any frame) or timed out: frames still showing it close it. */
  asked: 'bulkhead.on.asked',
} as const

export interface PanelConnection {
  id: string
  name: string
  driver: DriverKind
  production: boolean
  accessMode: AccessMode
  connected: boolean
  /** Where it points, e.g. `app@db:5432/app via ssh bastion`, or why the profile is broken. */
  target: string
}

export interface PanelState {
  connections: PanelConnection[]
  /** Stored entries that failed validation; kept, shown, never dropped. */
  invalid: { name: string; message: string }[]
  view: PanelView
  agents: { running: boolean; detail: string }
}

export type PanelView = 'main' | 'form'

export type ConnectionAction = 'connect' | 'disconnect' | 'unlock' | 'lock' | 'edit' | 'remove'

export interface ChildrenRequest {
  connectionId: string
  node?: ExplorerNode
}

export interface ConnectionRequest {
  connectionId: string
  action: ConnectionAction
}

export interface RunRequest {
  connectionId: string
  text: string
  /** `statement`: the one under `offset`; `script`: all of `text` (also a selection). */
  mode: 'statement' | 'script'
  offset?: number
  database?: string
  /** Shown above the results, e.g. columns hidden for lack of privileges. */
  notice?: string
}

export interface OpenConsoleRequest {
  connectionId: string
}

export interface OpenTableRequest {
  connectionId: string
  node: ExplorerNode
}

/** What the worker pushes on `PANEL.webview`: a message, or a reference to fetch in pages. */
export type WebviewPush = { message: unknown } | { large: { id: string; pages: number } }

/** The worker needs the user; the panel answers with `PANEL.prompt`. */
export type PanelAsk =
  | { id: string; kind: 'secret'; title: string; label: string }
  /** Production must be confirmed by typing `name`; the worker compares, not the panel. */
  | { id: string; kind: 'unlock'; name: string; production: boolean }

export interface PromptAnswer {
  id: string
  /** `null`: dismissed. */
  value: string | null
}

/** Every request answers with this, so errors reach the panel with their message. */
export type PanelReply<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * Editor tabs in Orca are files opened by the plugin's custom editors. A console (`.bhsql`) is
 * plain SQL whose first line names its connection; a table tab (`.bhtable`) is JSON saying what
 * to show. Neither holds a secret: only a connection id, never its password.
 */
export const CONSOLE_EXTENSION = '.bhsql'
export const TABLE_EXTENSION = '.bhtable'

const CONSOLE_HEADER = /^-- bulkhead connection: (\S+)[^\n]*(?:\n|$)/

export interface ConsoleFile {
  connectionId?: string
  sql: string
}

export function parseConsoleFile(text: string): ConsoleFile {
  const header = CONSOLE_HEADER.exec(text)
  if (!header) return { sql: text }
  return { connectionId: header[1]!, sql: text.slice(header[0].length) }
}

/** `label` is only a reminder for whoever opens the file as text; the id decides. */
export function formatConsoleFile({ connectionId, sql }: ConsoleFile, label?: string): string {
  if (!connectionId) return sql
  const note = label ? ` (${label.replace(/[\r\n]/g, ' ')})` : ''
  return `-- bulkhead connection: ${connectionId}${note}\n${sql}`
}

export interface TableFile {
  bulkhead: 'table'
  connectionId: string
  /** Shown on the tab and above the data. */
  title: string
  database?: string
  /** Absent when the role may read nothing; `notice` then says why. */
  query?: string
  notice?: string
}

export function parseTableFile(text: string): TableFile | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const file = value as Record<string, unknown>
  const optional = (key: string) => file[key] === undefined || typeof file[key] === 'string'
  if (
    file.bulkhead !== 'table' ||
    typeof file.connectionId !== 'string' ||
    typeof file.title !== 'string' ||
    !optional('database') ||
    !optional('query') ||
    !optional('notice')
  ) {
    return undefined
  }
  return value as TableFile
}
