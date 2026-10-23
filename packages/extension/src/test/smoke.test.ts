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
    // The tab model is updated asynchronously after a panel is created.
    await vscode.commands.executeCommand('bulkhead.connection.add')
    await waitFor(() => formTabs().length > 0)
    await vscode.commands.executeCommand('bulkhead.connection.add')
    await delay(300)
    assert.equal(formTabs().length, 1, `open tabs: ${describeTabs()}`)
    await vscode.window.tabGroups.close(formTabs())
  })

  test('survives a broken connection entry in settings', async () => {
    const config = vscode.workspace.getConfiguration('bulkhead')
    await config.update('connections', [{ name: 'broken' }], vscode.ConfigurationTarget.Global)
    await vscode.commands.executeCommand('bulkhead.explorer.refresh')
    await config.update('connections', undefined, vscode.ConfigurationTarget.Global)
  })
})

const allTabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs)

/** Webview panels get a view type prefixed by VS Code, e.g. `mainThreadWebview-bulkhead.connectionForm`. */
const formTabs = () =>
  allTabs().filter(
    (tab) =>
      tab.input instanceof vscode.TabInputWebview &&
      tab.input.viewType.endsWith('bulkhead.connectionForm'),
  )

const describeTabs = () =>
  allTabs()
    .map((tab) => {
      const input = tab.input as { viewType?: string } | undefined
      return `${tab.label} (${input?.viewType ?? typeof tab.input})`
    })
    .join(', ') || 'none'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out; open tabs: ${describeTabs()}`)
    await delay(50)
  }
}
