import {
  PANEL,
  type FormWebviewToHost,
  type WebviewPush,
  type WebviewToHost,
  type WelcomeAction,
} from '@bulkhead/core'

/**
 * The Orca side of the webview apps. An Orca HTML panel has no `acquireVsCodeApi`; it has a
 * global `orca` whose `plugin.request` reaches the plugin worker and whose `plugin.on` hears what
 * the worker posts. The same messages as in VS Code travel over it, with two differences:
 *
 * - Orca caps a worker push at 256 KiB, so the worker sends a large message as a reference and
 *   the panel fetches it in pages (`bulkhead.page`), each well under the 1 MiB reply cap.
 * - Copying never leaves the panel: the frame has the clipboard, and a copied result can be far
 *   larger than the 64 KiB a panel message may carry.
 *
 * Request and event names are `PANEL` from `@bulkhead/core`.
 */

export interface HostBridge {
  readonly name: string
  readonly actions: readonly WelcomeAction[]
  readonly tableHint: string
  post(message: WebviewToHost | FormWebviewToHost): void
  onMessage(handler: (message: unknown) => void): () => void
}

export interface OrcaDisposable {
  dispose(): void
}

/** The part of the frame API (`orca` global) the panel uses. */
export interface OrcaFrame {
  plugin: {
    request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<unknown>
    on(event: string, handler: (payload: unknown) => void): OrcaDisposable
  }
  host: { call(method: string, params?: unknown): Promise<unknown> }
  on(event: string, handler: (payload: unknown) => void): OrcaDisposable
  /** Custom editors only: the open file. */
  document?: OrcaDocument
}

/** The text document of a custom editor tab (`orca/frame`'s `EditorDocumentApi`). */
export interface OrcaDocument {
  get(): Promise<{ content: { kind: 'text'; text: string } | { kind: 'bytes' } }>
  onDidChange(
    handler: (document: { content: { kind: 'text'; text: string } | { kind: 'bytes' } }) => void,
  ): OrcaDisposable
  session(options?: { debounceMs?: number }): Promise<OrcaEditorSession>
}

export interface OrcaEditorSession {
  readonly value: string
  readonly readOnly: boolean
  change(next: string): void
  flush(): Promise<void>
  onReplace(handler: (value: string) => void): OrcaDisposable
  dispose(): void
}

declare global {
  interface Window {
    orca?: OrcaFrame
  }
}

const REPOSITORY = 'https://github.com/monstrikwho/bulkhead'
const LINKS: Partial<Record<WelcomeAction, string>> = {
  docs: `${REPOSITORY}#readme`,
  issues: `${REPOSITORY}/issues`,
  changelog: `${REPOSITORY}/blob/main/CHANGELOG.md`,
}

export function orcaFrame(): OrcaFrame {
  const frame = window.orca
  if (!frame) throw new Error('Bulkhead: neither VS Code nor Orca provided a host API.')
  return frame
}

export function orcaBridge(): HostBridge {
  const handlers = new Set<(message: unknown) => void>()
  const deliver = (message: unknown) => {
    for (const handler of [...handlers]) handler(message)
  }
  let subscribed = false
  const subscribe = () => {
    if (subscribed) return
    subscribed = true
    orcaFrame().plugin.on(PANEL.webview, (payload) => {
      const push = payload as WebviewPush
      if ('large' in push) void fetchLarge(push.large).then(deliver, reportError)
      else deliver(push.message)
    })
  }
  return {
    name: 'Orca',
    actions: ['new-connection', 'connect-agent', 'docs', 'issues', 'changelog'],
    tableHint: 'Double-click a table in Connections to show its data.',
    post(message) {
      if (message.type === 'copy') {
        void navigator.clipboard.writeText(message.text).catch(reportError)
        return
      }
      // Opening a link needs the click that caused it, so the panel opens it, not the worker.
      const link = message.type === 'action' ? LINKS[message.action] : undefined
      if (link) {
        orcaFrame().host.call('shell.openExternal', { url: link }).catch(reportError)
        return
      }
      orcaFrame().plugin.request(PANEL.webview, message, { timeoutMs: 120_000 }).catch(reportError)
    },
    onMessage(handler) {
      subscribe()
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}

async function fetchLarge({ id, pages }: { id: string; pages: number }): Promise<unknown> {
  let text = ''
  for (let index = 0; index < pages; index++) {
    text += (await orcaFrame().plugin.request(PANEL.page, { id, index })) as string
  }
  return JSON.parse(text) as unknown
}

function reportError(error: unknown): void {
  // Nowhere better to show it: the apps report failures the host sends them, not transport ones.
  // eslint-disable-next-line no-console
  console.warn('Bulkhead:', error instanceof Error ? error.message : String(error))
}
