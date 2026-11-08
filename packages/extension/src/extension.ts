import type { ConnectionProfile, WelcomeAction } from '@bulkhead/core'
import {
  AgentAccess,
  CancellationError,
  ConnectionManager,
  driverFor,
  QueryRunner,
  SecretVault,
  unlockWrites,
} from '@bulkhead/host'
import * as vscode from 'vscode'

import { ConnectionFormPanel, type FormDependencies } from './connections/formPanel'
import { ConnectionStore } from './connections/store'
import { ConnectionTreeProvider, type TreeElement } from './explorer/tree'
import { secretStore, t, vscodeUi } from './hostPorts'
import {
  agentStorageDir,
  bridgeSource,
  extensionVersion,
  VsCodeAgentAccess,
  workspaceFolders,
} from './mcp/agentAccess'
import { EditorBindings } from './query/editorBindings'
import { EditorRunner } from './query/runner'
import { ResultsView } from './results/resultsView'
import { TablePanel } from './results/tablePanel'

export function activate(context: vscode.ExtensionContext): void {
  const store = new ConnectionStore()
  const secrets = new SecretVault(secretStore(context.secrets))
  const ui = vscodeUi((existing, proposal) =>
    ConnectionFormPanel.show(formDeps, existing, proposal),
  )
  const manager = new ConnectionManager(secrets, ui)
  const tree = new ConnectionTreeProvider(store, manager)
  const bindings = new EditorBindings(context.workspaceState, store, manager)
  const results = new ResultsView(context.extensionUri, {
    cancel: (runId) => queries.cancel(runId),
    action: (action) => void welcomeAction(action),
  })
  const queries = new QueryRunner(manager, {
    results,
    maxRows: () => vscode.workspace.getConfiguration('bulkhead').get<number>('query.maxRows', 1000),
    ui,
    t,
  })
  const editorQueries = new EditorRunner(queries, bindings)
  const formDeps: FormDependencies = {
    extensionUri: context.extensionUri,
    store,
    secrets,
    manager,
    t,
  }
  const agents = new VsCodeAgentAccess(
    context,
    new AgentAccess({
      deps: formDeps,
      ui,
      storageDir: agentStorageDir(context),
      bridgeSource: bridgeSource(context),
      version: extensionVersion(context),
      workspaceFolders,
    }),
  )
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
        if (error instanceof CancellationError) return
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
      if (profile) await unlockWrites(manager, ui, profile)
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

    command('bulkhead.query.run', () => editorQueries.runEditor('statement')),
    command('bulkhead.query.runAll', () => editorQueries.runEditor('script')),
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
