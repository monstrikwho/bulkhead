import { z } from 'zod'

import { DRIVER_KINDS, type DriverKind } from './connection'
import type { OptionField, SecretField } from './driver'

/**
 * Messages between the extension host and the connection form webview. Plain JSON only. The
 * webview never touches settings or SecretStorage itself: it sends a draft, the host validates
 * it with the driver and saves it.
 */

/** What the form needs to know about a driver. */
export interface DriverDescriptor {
  kind: DriverKind
  displayName: string
  optionFields: readonly OptionField[]
  secretFields: readonly SecretField[]
}

export const connectionDraftSchema = z.object({
  /** Set when editing an existing connection. */
  id: z.string().min(1).optional(),
  name: z.string(),
  driver: z.enum(DRIVER_KINDS),
  production: z.boolean(),
  readOnly: z.boolean(),
  options: z.record(z.string(), z.unknown()),
  /**
   * Secrets typed in the form. When editing, a key that is missing or empty keeps the saved
   * value; a new connection with an empty password stores "no password".
   */
  secrets: z.record(z.string(), z.string()),
})
export type ConnectionDraft = z.infer<typeof connectionDraftSchema>

export type TestResult =
  { ok: true; durationMs: number; databases: string[] } | { ok: false; message: string }

export type ParseResult =
  | {
      ok: true
      driver: DriverKind
      options: Record<string, unknown>
      secrets: Record<string, string>
    }
  | { ok: false; message: string }

export type FormHostToWebview =
  | {
      type: 'init'
      drivers: DriverDescriptor[]
      /** The connection being edited; the form opens on the picker when absent. */
      existing?: { draft: ConnectionDraft; savedSecrets: string[] }
    }
  | { type: 'test-result'; requestId: number; result: TestResult }
  /** `result` is `null` when the text is not a connection string of any driver. */
  | { type: 'parsed'; requestId: number; result: ParseResult | null }
  | { type: 'save-failed'; message: string }

export type FormWebviewToHost =
  | { type: 'ready' }
  | { type: 'test'; requestId: number; draft: ConnectionDraft }
  | { type: 'parse'; requestId: number; text: string }
  | { type: 'save'; draft: ConnectionDraft }
  | { type: 'cancel' }

/** Shape check only; drafts are validated again with `connectionDraftSchema` before use. */
export function isFormWebviewToHost(value: unknown): value is FormWebviewToHost {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  switch (message.type) {
    case 'ready':
    case 'cancel':
      return true
    case 'test':
      return typeof message.requestId === 'number' && typeof message.draft === 'object'
    case 'parse':
      return typeof message.requestId === 'number' && typeof message.text === 'string'
    case 'save':
      return typeof message.draft === 'object' && message.draft !== null
    default:
      return false
  }
}
