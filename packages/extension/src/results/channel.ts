import type { HostToWebview } from '@bulkhead/core'
import type * as vscode from 'vscode'

/**
 * Delivers run messages to a webview. Messages sent before the webview reports `ready` are
 * replayed in order, including after VS Code recreates it; only the latest run is kept.
 */
export class RunChannel {
  private webview: vscode.Webview | undefined
  private ready = false
  private history: HostToWebview[] = []

  attach(webview: vscode.Webview): void {
    this.webview = webview
    this.ready = false
  }

  detach(): void {
    this.webview = undefined
    this.ready = false
  }

  markReady(): void {
    this.ready = true
    for (const queued of this.history) void this.webview?.postMessage(queued)
  }

  post(message: HostToWebview): void {
    if (message.type === 'run-started') this.history = []
    this.history.push(message)
    if (this.webview && this.ready) void this.webview.postMessage(message)
  }
}
