import { welcomeActions, type FormWebviewToHost, type WebviewToHost } from '@bulkhead/core'

import { orcaBridge, type HostBridge } from './orca/bridge'

/**
 * The one way the apps talk to their host. VS Code gives webviews `acquireVsCodeApi`; Orca gives
 * HTML panels a global `orca`, and `orca/bridge.ts` carries the same messages over it.
 */
const bridge: HostBridge =
  typeof acquireVsCodeApi === 'function' ? vscodeBridge(acquireVsCodeApi()) : orcaBridge()

/** Shown where the UI names the editor, e.g. whose secret storage keeps a password. */
export const hostName = bridge.name
/** Start screen shortcuts this host can carry out. */
export const hostActions = bridge.actions
export const tableHint = bridge.tableHint

export function post(message: WebviewToHost | FormWebviewToHost): void {
  bridge.post(message)
}

/** Messages from the host; the caller states which protocol it speaks. */
export function onMessage<Message>(handler: (message: Message) => void): () => void {
  return bridge.onMessage((message) => handler(message as Message))
}

function vscodeBridge(api: ReturnType<typeof acquireVsCodeApi>): HostBridge {
  return {
    name: 'VS Code',
    actions: welcomeActions,
    tableHint: 'Tables open in their own tab from the Connections view.',
    post: (message) => api.postMessage(message),
    onMessage(handler) {
      const listener = (event: MessageEvent<unknown>) => handler(event.data)
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    },
  }
}
