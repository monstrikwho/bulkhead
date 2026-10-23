import type { HostToWebview, WebviewToHost } from '@bulkhead/core'

const api = acquireVsCodeApi()

export function post(message: WebviewToHost): void {
  api.postMessage(message)
}

export function onMessage(handler: (message: HostToWebview) => void): () => void {
  const listener = (event: MessageEvent<HostToWebview>) => handler(event.data)
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
