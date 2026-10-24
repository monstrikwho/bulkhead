import { isWebviewToHost, type HostToWebview, type WelcomeAction } from '@bulkhead/core'
import * as vscode from 'vscode'

import { webviewHtml, webviewRoot } from '../webview/html'
import { RunChannel, type ResultsTarget } from './channel'

/**
 * The results of queries run from SQL editors, a React app in the bottom panel. Before the first
 * run it shows a start screen whose shortcuts come back as `action` messages.
 */
export class ResultsView implements vscode.WebviewViewProvider, ResultsTarget, vscode.Disposable {
  static readonly viewId = 'bulkhead.results'

  private view: vscode.WebviewView | undefined
  private readonly channel = new RunChannel()
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: {
      cancel: (runId: string) => void
      action: (action: WelcomeAction) => void
    },
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.channel.attach(view.webview)
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
            this.channel.markReady()
            break
          case 'cancel':
            this.handlers.cancel(message.runId)
            break
          case 'copy':
            void vscode.env.clipboard.writeText(message.text)
            break
          case 'action':
            this.handlers.action(message.action)
            break
        }
      }),
      view.onDidDispose(() => {
        this.view = undefined
        this.channel.detach()
      }),
    )
  }

  async reveal(): Promise<void> {
    if (this.view) this.view.show(true)
    else await vscode.commands.executeCommand(`${ResultsView.viewId}.focus`)
  }

  post(message: HostToWebview): void {
    this.channel.post(message)
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose()
  }
}
