import { randomBytes } from 'node:crypto'

import { isWebviewToHost, type HostToWebview } from '@bulkhead/core'
import * as vscode from 'vscode'

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
    const root = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    view.webview.options = { enableScripts: true, localResourceRoots: [root] }
    view.webview.html = this.html(view.webview, root)

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

  private html(webview: vscode.Webview, root: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64')
    const script = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.css'))
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ')
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${style.toString()}" />
    <title>Results</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${script.toString()}"></script>
  </body>
</html>`
  }
}
