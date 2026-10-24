import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
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

  test('lets an MCP agent open the connection form without saving', async () => {
    const client = await agent()
    const opened = await client.callTool({
      name: 'configure_connection',
      arguments: { name: 'from agent', options: { host: 'db.internal', user: 'app' } },
    })
    assert.ok(!opened.isError, JSON.stringify(opened.content))
    await waitFor(() => formTabs().length > 0)
    assert.equal(
      vscode.workspace.getConfiguration('bulkhead').get<unknown[]>('connections', []).length,
      0,
      'nothing is saved until the user saves',
    )
    const refused = await client.callTool({
      name: 'configure_connection',
      arguments: { connectionId: 'nope' },
    })
    assert.equal(refused.isError, true)
    await client.close()
    await vscode.window.tabGroups.close(formTabs())
  })

  test('lets an MCP agent test and save, but not weaken protection', async () => {
    const client = await agent()
    const connections = () =>
      vscode.workspace.getConfiguration('bulkhead').get<{ id: string }[]>('connections', [])

    // Port 1 refuses at once: the probe runs for real and reports the failure.
    const failed = await client.callTool({
      name: 'test_connection',
      arguments: { options: { host: '127.0.0.1', port: 1, user: 'app' } },
    })
    assert.equal(failed.isError, true, JSON.stringify(failed.content))

    const saved = await client.callTool({
      name: 'save_connection',
      arguments: {
        name: 'orders',
        environment: 'production',
        options: { host: 'db.internal', user: 'app' },
        secrets: { password: 'smoke-only' },
      },
    })
    assert.ok(!saved.isError, JSON.stringify(saved.content))
    await waitFor(() => connections().length === 1)
    const [profile] = connections()
    assert.ok(!JSON.stringify(profile).includes('smoke-only'), 'no secret in settings')

    const weakened = await client.callTool({
      name: 'save_connection',
      arguments: { connectionId: profile!.id, environment: 'development' },
    })
    assert.equal(weakened.isError, true)
    assert.ok(JSON.stringify(weakened.content).includes('configure_connection'))
    await client.close()
    await vscode.workspace
      .getConfiguration('bulkhead')
      .update('connections', undefined, vscode.ConfigurationTarget.Global)
  })

  test('survives a broken connection entry in settings', async () => {
    const config = vscode.workspace.getConfiguration('bulkhead')
    await config.update('connections', [{ name: 'broken' }], vscode.ConfigurationTarget.Global)
    await vscode.commands.executeCommand('bulkhead.explorer.refresh')
    await config.update('connections', undefined, vscode.ConfigurationTarget.Global)
  })
})

/** An MCP client connected to this window's server, found through its instance file. */
async function agent(): Promise<Client> {
  const userData = process.env.BULKHEAD_TEST_USER_DATA
  assert.ok(userData, 'run through scripts/run-e2e.mjs')
  const file = join(
    userData,
    'User/globalStorage/bulkhead.bulkhead/mcp/instances',
    `${process.pid}.json`,
  )
  await waitFor(() => readInstance(file) !== undefined)
  const { port, token } = readInstance(file)!
  const client = new Client({ name: 'smoke', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

function readInstance(file: string): { port: number; token: string } | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { port: number; token: string }
  } catch {
    return undefined
  }
}

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
