import { isWebviewToHost, type HostToWebview } from '@bulkhead/core'
import * as vscode from 'vscode'

import { webviewHtml, webviewRoot } from '../webview/html'
import { RunChannel, type ResultsTarget } from './channel'

export interface TableSource {
  /** Same key → same tab, e.g. `<connection id>/<node id>`. */
  key: string
  title: string
  /** Runs the table's query into the tab; called on open, on reopen and on Refresh. */
  load: (target: TablePanel) => Promise<void>
  cancel: (runId: string) => void
}

/**
 * A table's data in its own editor tab, like a file. Opening the same table again reveals its
 * tab and reloads it.
 */
export class TablePanel implements ResultsTarget {
  private static readonly open = new Map<string, TablePanel>()

  static show(extensionUri: vscode.Uri, source: TableSource): void {
    const current = TablePanel.open.get(source.key)
    if (current) {
      current.panel.reveal()
      void current.source.load(current)
      return
    }
    const panel = new TablePanel(extensionUri, source)
    TablePanel.open.set(source.key, panel)
    void source.load(panel)
  }

  private readonly panel: vscode.WebviewPanel
  private readonly channel = new RunChannel()
  private readonly disposables: vscode.Disposable[] = []
  private runId: string | undefined

  private constructor(
    extensionUri: vscode.Uri,
    private readonly source: TableSource,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'bulkhead.table',
      source.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot(extensionUri)],
      },
    )
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'bulkhead.svg')
    this.channel.attach(this.panel.webview)
    this.panel.webview.html = webviewHtml(this.panel.webview, extensionUri, 'table', source.title)
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        if (!isWebviewToHost(message)) return
        switch (message.type) {
          case 'ready':
            this.channel.markReady()
            break
          case 'cancel':
            this.source.cancel(message.runId)
            break
          case 'copy':
            void vscode.env.clipboard.writeText(message.text)
            break
          case 'refresh':
            void this.source.load(this)
            break
        }
      }),
      this.panel.onDidDispose(() => this.dispose()),
    )
  }

  reveal(): void {
    if (!this.panel.visible) this.panel.reveal(undefined, true)
  }

  post(message: HostToWebview): void {
    this.runId = message.runId
    this.channel.post(message)
  }

  private dispose(): void {
    // Closing the tab stops its query: nobody is left to see the result.
    if (this.runId) this.source.cancel(this.runId)
    TablePanel.open.delete(this.source.key)
    this.channel.detach()
    for (const disposable of this.disposables) disposable.dispose()
  }
}
