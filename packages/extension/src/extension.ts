import type { ConnectionProfile, WelcomeAction } from '@bulkhead/core'
import * as vscode from 'vscode'

import { ConnectionFormPanel } from './connections/formPanel'
import { ConnectionManager } from './connections/manager'
import { SecretVault } from './connections/secrets'
import { ConnectionStore } from './connections/store'
import { driverFor } from './drivers'
import { ConnectionTreeProvider, type TreeElement } from './explorer/tree'
import { AgentAccess } from './mcp/agentAccess'
import { EditorBindings } from './query/editorBindings'
import { QueryRunner } from './query/runner'
import { ResultsView } from './results/resultsView'
import { TablePanel } from './results/tablePanel'

export function activate(context: vscode.ExtensionContext): void {
  const store = new ConnectionStore()
  const secrets = new SecretVault(context.secrets)
  const manager = new ConnectionManager(secrets)
  const tree = new ConnectionTreeProvider(store, manager)
  const bindings = new EditorBindings(context.workspaceState, store, manager)
  const results = new ResultsView(context.extensionUri, {
    cancel: (runId) => queries.cancel(runId),
    action: (action) => void welcomeAction(action),
  })
  const queries = new QueryRunner(manager, bindings, results)
  const formDeps = { extensionUri: context.extensionUri, store, secrets, manager }
  const agents = new AgentAccess(context, formDeps)
  void agents.update()

  const treeView = vscode.window.createTreeView('bulkhead.connections', {
    treeDataProvider: tree,
    showCollapseAll: true,
  })

  const command = (id: string, handler: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        await handler(...args)
      } catch (error) {
        if (error instanceof vscode.CancellationError) return
        const message = error instanceof Error ? error.message : String(error)
        void vscode.window.showErrorMessage(`Bulkhead: ${message}`)
      }
    })

  /** Tree commands get the clicked element; palette invocations get nothing and ask. */
  const profileOf = async (element?: TreeElement): Promise<ConnectionProfile | undefined> => {
    if (element && element.type !== 'message') return element.profile
    if (element?.profile) return element.profile
    const { profiles } = store.list()
    const picked = await vscode.window.showQuickPick(
      profiles.map((profile) => ({ label: profile.name, profile })),
      { placeHolder: vscode.l10n.t('Connection') },
    )
    return picked?.profile
  }

  context.subscriptions.push(
    store,
    manager,
    bindings,
    results,
    agents,
    treeView,
    vscode.window.registerWebviewViewProvider(ResultsView.viewId, results, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    store.onDidChange(() => {
      void manager.reconcile(store.list().profiles)
      tree.refresh()
    }),
    manager.onDidChange(() => tree.refresh()),

    command('bulkhead.connection.add', () => ConnectionFormPanel.show(formDeps)),

    command('bulkhead.connection.edit', async (element?: TreeElement) => {
      const existing = await profileOf(element)
      if (existing) ConnectionFormPanel.show(formDeps, existing)
    }),

    command('bulkhead.connection.remove', async (element?: TreeElement) => {
      const profile = await profileOf(element)
      if (!profile) return
      const remove = vscode.l10n.t('Remove')
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Remove connection "{0}" and its saved password?', profile.name),
        { modal: true },
        remove,
      )
      if (answer !== remove) return
      await manager.disconnect(profile.id)
      await secrets.deleteAll(profile.id, driverFor(profile.driver).secretFields)
      await store.remove(profile.id)
    }),

    command('bulkhead.connection.connect', async (element?: TreeElement) => {
      const profile = await profileOf(element)
      if (!profile) return
      await manager.session(profile)
      if (element) await treeView.reveal(element, { expand: true })
    }),

    command('bulkhead.connection.disconnect', async (element?: TreeElement) => {
      const profile = await profileOf(element)
      if (profile) await manager.disconnect(profile.id)
    }),

    command('bulkhead.connection.unlockWrites', async (element?: TreeElement) => {
      const profile = await profileOf(element)
      if (!profile || !(await confirmUnlock(profile))) return
      await manager.setAccessMode(profile, 'read-write')
    }),

    command('bulkhead.connection.lockWrites', async (element?: TreeElement) => {
      const profile = await profileOf(element)
      if (profile) await manager.setAccessMode(profile, 'read-only')
    }),

    command('bulkhead.mcp.connectAgent', () => agents.connectAgent()),

    command('bulkhead.explorer.refresh', (element?: TreeElement) => tree.refresh(element)),

    command('bulkhead.query.new', async (element?: TreeElement) => {
      const profile = await profileOf(element)
      if (!profile) return
      const database = element?.type === 'node' ? element.node.database : undefined
      const document = await vscode.workspace.openTextDocument({ language: 'sql', content: '' })
      await bindings.set(document, { connectionId: profile.id, database })
      await vscode.window.showTextDocument(document)
    }),

    command('bulkhead.query.run', () => queries.runEditor('statement')),
    command('bulkhead.query.runAll', () => queries.runEditor('script')),
    command('bulkhead.query.cancel', () => queries.cancel()),

    command('bulkhead.query.selectConnection', async () => {
      const editor = vscode.window.activeTextEditor
      if (editor) await bindings.pick(editor.document)
    }),

    command('bulkhead.node.open', (element?: TreeElement) => {
      if (element?.type !== 'node') return
      const { profile, node } = element
      const query = node.previewQuery
      if (!query) return
      TablePanel.show(context.extensionUri, {
        key: `${profile.id}/${node.id}`,
        title: node.label,
        load: (panel) => queries.run(profile, query, node.database, panel),
        cancel: (runId) => queries.cancel(runId),
      })
    }),

    command('bulkhead.node.copyName', async (element?: TreeElement) => {
      if (element?.type !== 'node') return
      await vscode.env.clipboard.writeText(element.node.qualifiedName ?? element.node.label)
    }),
  )
}

export function deactivate(): void {
  // Sessions are closed by ConnectionManager.dispose via context.subscriptions.
}

const REPOSITORY = 'https://github.com/monstrikwho/bulkhead'

/** The shortcuts on the results panel's start screen. */
async function welcomeAction(action: WelcomeAction): Promise<void> {
  switch (action) {
    case 'new-connection':
      await vscode.commands.executeCommand('bulkhead.connection.add')
      break
    case 'new-query':
      await vscode.commands.executeCommand('bulkhead.query.new')
      break
    case 'connect-agent':
      await vscode.commands.executeCommand('bulkhead.mcp.connectAgent')
      break
    case 'open-sql-file': {
      const [file] =
        (await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { SQL: ['sql'] },
          openLabel: vscode.l10n.t('Open'),
        })) ?? []
      if (file) await vscode.window.showTextDocument(file)
      break
    }
    case 'docs':
      await vscode.env.openExternal(vscode.Uri.parse(`${REPOSITORY}#readme`))
      break
    case 'issues':
      await vscode.env.openExternal(vscode.Uri.parse(`${REPOSITORY}/issues`))
      break
    case 'changelog':
      await vscode.env.openExternal(vscode.Uri.parse(`${REPOSITORY}/blob/main/CHANGELOG.md`))
      break
  }
}

/**
 * Unlocking a production connection requires typing its name: a deliberate act, not a reflex
 * click. Other read-only connections only need a confirmation.
 */
async function confirmUnlock(profile: ConnectionProfile): Promise<boolean> {
  if (!profile.production) {
    const unlock = vscode.l10n.t('Unlock')
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('Allow writes on "{0}" until you disconnect?', profile.name),
      { modal: true },
      unlock,
    )
    return answer === unlock
  }
  const typed = await vscode.window.showInputBox({
    title: vscode.l10n.t('Unlock writes on PRODUCTION'),
    prompt: vscode.l10n.t(
      'Writes stay unlocked until you disconnect or lock them again. Type "{0}" to confirm.',
      profile.name,
    ),
    ignoreFocusOut: true,
    validateInput: (value) =>
      value === profile.name ? undefined : vscode.l10n.t('Type the connection name exactly'),
  })
  return typed === profile.name
}
