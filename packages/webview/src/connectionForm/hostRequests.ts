import type { ConnectionDraft, FormHostToWebview, ParseResult, TestResult } from '@bulkhead/core'

import { post } from '../vscode'

type Pending = (message: FormHostToWebview) => void

let nextId = 1
const pending = new Map<number, Pending>()

/** Routes a host reply to the request that asked for it. Returns false for other messages. */
export function settle(message: FormHostToWebview): boolean {
  if (message.type !== 'parsed' && message.type !== 'test-result') return false
  const resolve = pending.get(message.requestId)
  pending.delete(message.requestId)
  resolve?.(message)
  return true
}

function request(send: (requestId: number) => void): Promise<FormHostToWebview> {
  const requestId = nextId++
  return new Promise((resolve) => {
    pending.set(requestId, resolve)
    send(requestId)
  })
}

/** Asks the drivers whether `text` is a connection string; `null` if none recognises it. */
export async function parseConnectionString(text: string): Promise<ParseResult | null> {
  const reply = await request((requestId) => post({ type: 'parse', requestId, text }))
  return reply.type === 'parsed' ? reply.result : null
}

export async function testConnection(draft: ConnectionDraft): Promise<TestResult> {
  const reply = await request((requestId) => post({ type: 'test', requestId, draft }))
  return reply.type === 'test-result' ? reply.result : { ok: false, message: 'No reply' }
}

/** Cheap check before bothering the host: does this look like a pasted connection string? */
export function looksLikeConnectionString(text: string): boolean {
  return /^\s*[a-z][a-z0-9+.-]*:\/\//i.test(text) || /\b(host|dbname)\s*=/.test(text)
}
