import { isWebviewToHost, type HostToWebview } from '@bulkhead/core'
import * as vscode from 'vscode'

import { webviewHtml, webviewRoot } from '../webview/html'

/**
 * The results grid, a React app in the bottom panel. Messages sent before the webview is ready
 * are replayed in order once it reports `ready`, including after VS Code recreates it.
 */
export class ResultsView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'bulkhead.results'

  private view: vscode.WebviewView | undefined
  private ready = false
  /** Messages of the latest run only: enough to restore the view. */
  private history: HostToWebview[] = []
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onCancel: (runId: string) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.ready = false
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot(this.extensionUri)],
    }
    view.webview.html = webviewHtml(view.webview, this.extensionUri, 'results', 'Results')

    this.disposables.push(
      view.webview.onDidReceiveMessage((message: unknown) => {
        if (!isWebviewToHost(message)) return
        switch (message.type) {
          case 'ready':
            this.ready = true
            for (const queued of this.history) void view.webview.postMessage(queued)
            break
          case 'cancel':
            this.onCancel(message.runId)
            break
          case 'copy':
            void vscode.env.clipboard.writeText(message.text)
            break
        }
      }),
      view.onDidDispose(() => {
        this.view = undefined
        this.ready = false
      }),
    )
  }

  async reveal(): Promise<void> {
    if (this.view) this.view.show(true)
    else await vscode.commands.executeCommand(`${ResultsView.viewId}.focus`)
  }

  post(message: HostToWebview): void {
    if (message.type === 'run-started') this.history = []
    this.history.push(message)
    if (this.view && this.ready) void this.view.webview.postMessage(message)
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose()
  }
}
