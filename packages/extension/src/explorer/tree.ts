import type { ConnectionProfile, ExplorerNode } from '@bulkhead/core'
import * as vscode from 'vscode'

import type { ConnectionManager } from '../connections/manager'
import type { ConnectionStore } from '../connections/store'
import { driverFor } from '../drivers'

export type TreeElement =
  | { type: 'connection'; profile: ConnectionProfile }
  | { type: 'node'; profile: ConnectionProfile; node: ExplorerNode }
  | { type: 'message'; profile?: ConnectionProfile; text: string; error: boolean }

/**
 * Connection → whatever the driver returns. Production connections are red everywhere and say
 * whether writes are locked; that state is also encoded in `contextValue` for menus.
 */
export class ConnectionTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly changed = new vscode.EventEmitter<TreeElement | undefined>()
  readonly onDidChangeTreeData = this.changed.event

  constructor(
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
  ) {}

  refresh(element?: TreeElement): void {
    this.changed.fire(element)
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    switch (element.type) {
      case 'connection':
        return this.connectionItem(element.profile)
      case 'node':
        return nodeItem(element.profile, element.node)
      case 'message': {
        const item = new vscode.TreeItem(element.text)
        item.iconPath = new vscode.ThemeIcon(element.error ? 'error' : 'info')
        item.tooltip = element.text
        return item
      }
    }
  }

  /** Only connections are ever revealed, and they are roots. */
  getParent(): undefined {
    return undefined
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!element) return this.roots()
    if (element.type === 'message') return []

    const { profile } = element
    try {
      const session = await this.manager.session(profile)
      const nodes = await session.listChildren(element.type === 'node' ? element.node : undefined)
      if (nodes.length === 0) return [{ type: 'message', profile, text: 'Empty', error: false }]
      return nodes.map((node) => ({ type: 'node', profile, node }))
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        return [{ type: 'message', profile, text: vscode.l10n.t('Not connected'), error: false }]
      }
      const message = error instanceof Error ? error.message : String(error)
      return [{ type: 'message', profile, text: message, error: true }]
    }
  }

  private roots(): TreeElement[] {
    const { profiles, invalid } = this.store.list()
    return [
      ...profiles.map((profile): TreeElement => ({ type: 'connection', profile })),
      ...invalid.map((entry): TreeElement => ({
        type: 'message',
        text: vscode.l10n.t('Invalid connection "{0}" in settings: {1}', entry.name, entry.message),
        error: true,
      })),
    ]
  }

  private connectionItem(profile: ConnectionProfile): vscode.TreeItem {
    const driver = driverFor(profile.driver)
    const connected = this.manager.isConnected(profile.id)
    const readOnly = this.manager.accessMode(profile) === 'read-only'

    const item = new vscode.TreeItem(profile.name, vscode.TreeItemCollapsibleState.Collapsed)
    item.id = profile.id
    let summary: string
    try {
      summary = driver.describe(driver.parseOptions(profile.options))
    } catch (error) {
      summary = error instanceof Error ? error.message : String(error)
    }

    const badges: string[] = []
    if (profile.production) badges.push(readOnly ? 'PROD · read-only' : 'PROD · WRITES UNLOCKED')
    else if (readOnly) badges.push('read-only')
    item.description = [...badges, summary].join(' — ')

    const color = profile.production
      ? new vscode.ThemeColor('charts.red')
      : connected
        ? new vscode.ThemeColor('charts.green')
        : undefined
    item.iconPath = new vscode.ThemeIcon(
      profile.production ? (readOnly ? 'shield' : 'warning') : 'database',
      color,
    )

    const tooltip = new vscode.MarkdownString(`**${profile.name}** · ${driver.displayName}\n\n`)
    tooltip.appendText(summary)
    if (profile.production) {
      tooltip.appendMarkdown(
        readOnly
          ? '\n\n$(shield) Production: read-only. Use **Unlock Writes…** to allow changes.'
          : '\n\n$(warning) Production: **writes are unlocked** until you disconnect.',
      )
    }
    tooltip.supportThemeIcons = true
    item.tooltip = tooltip

    item.contextValue = [
      'connection',
      connected ? 'connected' : 'disconnected',
      profile.production ? 'prod' : 'dev',
      readOnly ? 'locked' : 'writable',
    ].join('|')
    return item
  }
}

function nodeItem(profile: ConnectionProfile, node: ExplorerNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.label,
    node.expandable
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  )
  item.id = `${profile.id}/${node.id}`
  item.description = node.description
  item.tooltip = node.tooltip
  if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon)
  item.contextValue = ['node', node.kind, node.previewQuery ? 'previewable' : '']
    .filter(Boolean)
    .join('|')
  return item
}
