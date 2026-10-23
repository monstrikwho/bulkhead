import type { ConnectionProfile } from '@bulkhead/core'
import * as vscode from 'vscode'

import type { ConnectionManager } from '../connections/manager'
import type { ConnectionStore } from '../connections/store'

export interface EditorBinding {
  connectionId: string
  database?: string
}

const STATE_KEY = 'bulkhead.editorBindings'

/**
 * Which connection a SQL editor runs against. Remembered per document in workspace state, and
 * shown in the status bar — in warning colours for a production connection, error colours once
 * its writes are unlocked.
 */
export class EditorBindings implements vscode.Disposable {
  private readonly statusItem = vscode.window.createStatusBarItem(
    'bulkhead.connection',
    vscode.StatusBarAlignment.Left,
    100,
  )
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly state: vscode.Memento,
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
  ) {
    this.statusItem.name = 'Bulkhead Connection'
    this.statusItem.command = 'bulkhead.query.selectConnection'
    this.disposables.push(
      this.statusItem,
      vscode.window.onDidChangeActiveTextEditor(() => this.render()),
      store.onDidChange(() => this.render()),
      manager.onDidChange(() => this.render()),
    )
    this.render()
  }

  get(document: vscode.TextDocument): EditorBinding | undefined {
    return this.all()[document.uri.toString()]
  }

  async set(document: vscode.TextDocument, binding: EditorBinding): Promise<void> {
    await this.state.update(STATE_KEY, { ...this.all(), [document.uri.toString()]: binding })
    this.render()
  }

  /** The bound profile, asking the user to pick one when the editor is not bound yet. */
  async resolve(
    document: vscode.TextDocument,
  ): Promise<{ profile: ConnectionProfile; binding: EditorBinding } | undefined> {
    const binding = this.get(document)
    const profile = binding && this.store.get(binding.connectionId)
    if (binding && profile) return { profile, binding }
    return this.pick(document)
  }

  async pick(
    document: vscode.TextDocument,
  ): Promise<{ profile: ConnectionProfile; binding: EditorBinding } | undefined> {
    const { profiles } = this.store.list()
    if (profiles.length === 0) {
      const add = vscode.l10n.t('Add Connection')
      const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('No connections yet.'),
        add,
      )
      if (choice === add) await vscode.commands.executeCommand('bulkhead.connection.add')
      return undefined
    }
    const picked = await vscode.window.showQuickPick(
      profiles.map((profile) => ({
        label: profile.production ? `$(shield) ${profile.name}` : profile.name,
        description: profile.production ? 'PROD' : undefined,
        profile,
      })),
      { placeHolder: vscode.l10n.t('Run this editor against…') },
    )
    if (!picked) return undefined
    const binding = { connectionId: picked.profile.id }
    await this.set(document, binding)
    return { profile: picked.profile, binding }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose()
  }

  private all(): Record<string, EditorBinding> {
    return this.state.get<Record<string, EditorBinding>>(STATE_KEY, {})
  }

  private render(): void {
    const document = vscode.window.activeTextEditor?.document
    if (!document || document.languageId !== 'sql') {
      this.statusItem.hide()
      return
    }
    const binding = this.get(document)
    const profile = binding && this.store.get(binding.connectionId)
    if (!profile) {
      this.statusItem.text = `$(database) ${vscode.l10n.t('Select connection')}`
      this.statusItem.backgroundColor = undefined
      this.statusItem.tooltip = vscode.l10n.t('Choose the connection this editor runs against')
      this.statusItem.show()
      return
    }

    const readOnly = this.manager.accessMode(profile) === 'read-only'
    const target = binding.database ? `${profile.name} / ${binding.database}` : profile.name
    if (profile.production) {
      this.statusItem.text = readOnly
        ? `$(shield) PROD ${target} · read-only`
        : `$(warning) PROD ${target} · WRITES UNLOCKED`
      this.statusItem.backgroundColor = new vscode.ThemeColor(
        readOnly ? 'statusBarItem.warningBackground' : 'statusBarItem.errorBackground',
      )
    } else {
      this.statusItem.text = `$(database) ${target}${readOnly ? ' · read-only' : ''}`
      this.statusItem.backgroundColor = undefined
    }
    this.statusItem.tooltip = vscode.l10n.t('Bulkhead: click to change the connection')
    this.statusItem.show()
  }
}
