import type { StatementOutcome } from './driver'
import type { AccessMode } from './safety/policy'

/** Messages between the extension host and the results webview. Plain JSON only. */

export interface ConnectionBadge {
  name: string
  database?: string
  production: boolean
  accessMode: AccessMode
}

export type HostToWebview =
  | {
      type: 'run-started'
      runId: string
      connection: ConnectionBadge
      script: string
      startedAt: number
    }
  | { type: 'run-finished'; runId: string; outcomes: StatementOutcome[]; finishedAt: number }
  | { type: 'run-failed'; runId: string; message: string; finishedAt: number }

export type WebviewToHost =
  { type: 'ready' } | { type: 'cancel'; runId: string } | { type: 'copy'; text: string }

export function isWebviewToHost(value: unknown): value is WebviewToHost {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  switch (message.type) {
    case 'ready':
      return true
    case 'cancel':
      return typeof message.runId === 'string'
    case 'copy':
      return typeof message.text === 'string'
    default:
      return false
  }
}
