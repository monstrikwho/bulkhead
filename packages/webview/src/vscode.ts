import type { FormWebviewToHost, WebviewToHost } from '@bulkhead/core'

const api = acquireVsCodeApi()

export function post(message: WebviewToHost | FormWebviewToHost): void {
  api.postMessage(message)
}

/** Messages from the extension host; the caller states which protocol it speaks. */
export function onMessage<Message>(handler: (message: Message) => void): () => void {
  const listener = (event: MessageEvent<Message>) => handler(event.data)
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
