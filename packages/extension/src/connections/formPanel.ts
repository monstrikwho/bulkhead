import type { ConnectionProfile, FormHostToWebview, ProposedDraft } from '@bulkhead/core'
import { FormBusyError, FormSession, type DraftDependencies } from '@bulkhead/host'
import * as vscode from 'vscode'

import { webviewHtml, webviewRoot } from '../webview/html'

export interface FormDependencies extends DraftDependencies {
  extensionUri: vscode.Uri
}

/**
 * The "new connection" / "edit connection" page: a webview in the editor area. One panel per
 * connection being edited, and one for a new connection; opening it again reveals it.
 */
export class ConnectionFormPanel {
  private static readonly open = new Map<string, ConnectionFormPanel>()

  /**
   * `proposal` is a draft an AI agent asked for (`mcp/agentAccess.ts`). It fills a new form;
   * an open one is refused (`FormBusyError`), so it never overwrites what the user typed.
   * Saving stays the user's click.
   */
  static show(
    deps: FormDependencies,
    existing?: ConnectionProfile,
    proposal?: ProposedDraft,
  ): void {
    const key = existing?.id ?? 'new'
    const current = ConnectionFormPanel.open.get(key)
    if (current) {
      current.panel.reveal()
      if (proposal) throw new FormBusyError(existing?.name)
      return
    }
    ConnectionFormPanel.open.set(key, new ConnectionFormPanel(deps, key, existing, proposal))
  }

  private readonly panel: vscode.WebviewPanel
  private readonly session: FormSession
  private readonly disposables: vscode.Disposable[] = []

  private constructor(
    private readonly deps: FormDependencies,
    private readonly key: string,
    existing: ConnectionProfile | undefined,
    proposal: ProposedDraft | undefined,
  ) {
    const title = existing
      ? vscode.l10n.t('Edit {0}', existing.name)
      : vscode.l10n.t('New Connection')
    this.panel = vscode.window.createWebviewPanel(
      'bulkhead.connectionForm',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot(deps.extensionUri)],
      },
    )
    this.panel.iconPath = vscode.Uri.joinPath(deps.extensionUri, 'media', 'bulkhead.svg')
    this.panel.webview.html = webviewHtml(
      this.panel.webview,
      deps.extensionUri,
      'connection-form',
      title,
    )
    this.session = new FormSession(
      deps,
      existing,
      proposal,
      (message) => this.post(message),
      (saved) => {
        this.panel.dispose()
        if (saved) void vscode.commands.executeCommand('bulkhead.connections.focus')
      },
    )
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage(
        (message: unknown) => void this.session.receive(message),
      ),
      this.panel.onDidDispose(() => this.dispose()),
    )
  }

  private post(message: FormHostToWebview): void {
    void this.panel.webview.postMessage(message)
  }

  private dispose(): void {
    ConnectionFormPanel.open.delete(this.key)
    for (const disposable of this.disposables) disposable.dispose()
  }
}
