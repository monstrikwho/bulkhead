import * as assert from 'node:assert/strict'

import * as vscode from 'vscode'

const EXTENSION_ID = 'bulkhead.bulkhead'

suite('extension smoke', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(extension, `${EXTENSION_ID} is installed`)
    await extension.activate()
  })

  test('registers every contributed command', async () => {
    const manifest = vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON as {
      contributes: { commands: { command: string }[] }
    }
    const registered = new Set(await vscode.commands.getCommands(true))
    const missing = manifest.contributes.commands
      .map((c) => c.command)
      .filter((id) => !registered.has(id))
    assert.deepEqual(missing, [])
  })

  test('opens the connections view and the results panel', async () => {
    await vscode.commands.executeCommand('bulkhead.connections.focus')
    await vscode.commands.executeCommand('bulkhead.results.focus')
  })

  test('opens the connection form once, in an editor tab', async () => {
    const formTabs = () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) => tab.input instanceof vscode.TabInputWebview && tab.label === 'New Connection',
        )
    await vscode.commands.executeCommand('bulkhead.connection.add')
    await vscode.commands.executeCommand('bulkhead.connection.add')
    assert.equal(formTabs().length, 1)
    await vscode.window.tabGroups.close(formTabs())
  })

  test('survives a broken connection entry in settings', async () => {
    const config = vscode.workspace.getConfiguration('bulkhead')
    await config.update('connections', [{ name: 'broken' }], vscode.ConfigurationTarget.Global)
    await vscode.commands.executeCommand('bulkhead.explorer.refresh')
    await config.update('connections', undefined, vscode.ConfigurationTarget.Global)
  })
})
