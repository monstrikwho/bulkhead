import {
  isFormWebviewToHost,
  type ConnectionProfile,
  type FormHostToWebview,
  type FormStartData,
  type ProposedDraft,
} from '@bulkhead/core'
import {
  describeDriver,
  describeError,
  drivers,
  parseConnectionString,
  parseDraft,
  saveDraft,
  savedDraft,
  testDraft,
  type DraftDependencies,
} from '@bulkhead/host'
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
   * `proposal` is a draft an AI agent asked for (`mcp/agentAccess.ts`). It refills the form,
   * open or not; saving stays the user's click.
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
      if (proposal) current.propose(proposal)
      return
    }
    ConnectionFormPanel.open.set(key, new ConnectionFormPanel(deps, key, existing, proposal))
  }

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []
  private ready = false

  private constructor(
    private readonly deps: FormDependencies,
    private readonly key: string,
    private readonly existing: ConnectionProfile | undefined,
    private proposal: ProposedDraft | undefined,
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
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => void this.receive(message)),
      this.panel.onDidDispose(() => this.dispose()),
    )
  }

  private post(message: FormHostToWebview): void {
    void this.panel.webview.postMessage(message)
  }

  private async receive(message: unknown): Promise<void> {
    if (!isFormWebviewToHost(message)) return
    switch (message.type) {
      case 'ready':
        this.ready = true
        await this.init()
        break
      case 'parse':
        this.post({
          type: 'parsed',
          requestId: message.requestId,
          result: parseConnectionString(message.text),
        })
        break
      case 'test':
        this.post({
          type: 'test-result',
          requestId: message.requestId,
          result: await this.test(message.draft),
        })
        break
      case 'save':
        await this.save(message.draft)
        break
      case 'cancel':
        this.panel.dispose()
        break
    }
  }

  private propose(proposal: ProposedDraft): void {
    this.proposal = proposal
    // Before `ready` the webview has not asked yet; its `ready` sends the proposal.
    if (this.ready) void this.init()
  }

  private async init(): Promise<void> {
    let start: FormStartData | undefined
    if (this.existing) start = await savedDraft(this.existing, this.deps.secrets)
    if (this.proposal) {
      const { draft, changed, warnings } = this.proposal
      start = { draft, savedSecrets: start?.savedSecrets ?? [], proposal: { changed, warnings } }
    }
    this.post({
      type: 'init',
      drivers: [...drivers.values()].map(describeDriver),
      ...(start ? { start } : {}),
    })
  }

  private test(raw: unknown) {
    return testDraft(this.deps, raw, this.existing)
  }

  private async save(raw: unknown): Promise<void> {
    try {
      await saveDraft(this.deps, parseDraft(raw), this.existing)
    } catch (error) {
      this.post({ type: 'save-failed', message: describeError(error) })
      return
    }
    this.panel.dispose()
    await vscode.commands.executeCommand('bulkhead.connections.focus')
  }

  private dispose(): void {
    ConnectionFormPanel.open.delete(this.key)
    for (const disposable of this.disposables) disposable.dispose()
  }
}
