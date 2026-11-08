import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConnectionManager } from '../connections/manager'
import { SecretVault } from '../connections/secrets'
import { format, MemoryProfiles, MemorySecrets, RecordingUi } from '../testing'
import { AgentAccess } from './agentAccess'
import { readInstances } from './discovery'

let dir: string
let profiles: MemoryProfiles
let secrets: MemorySecrets
let ui: RecordingUi
let access: AgentAccess

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bulkhead-agents-'))
  writeFileSync(join(dir, 'built-bridge.js'), '// bridge')
  profiles = new MemoryProfiles()
  secrets = new MemorySecrets()
  ui = new RecordingUi()
  const vault = new SecretVault(secrets)
  access = new AgentAccess({
    deps: { store: profiles, secrets: vault, manager: new ConnectionManager(vault, ui), t: format },
    ui,
    storageDir: join(dir, 'mcp'),
    bridgeSource: join(dir, 'built-bridge.js'),
    version: '0.0.0-test',
    workspaceFolders: () => ['/work/shop'],
  })
})
afterEach(async () => {
  await access.setEnabled(false)
  access.dispose()
  rmSync(dir, { recursive: true, force: true })
})

async function client(): Promise<Client> {
  const server = access.running
  if (!server) throw new Error('not running')
  const connected = new Client({ name: 'test', version: '1' })
  await connected.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { authorization: `Bearer ${server.token}` } },
    }),
  )
  return connected
}

describe('AgentAccess', () => {
  it('copies the bridge, announces the window and cleans up when turned off', async () => {
    let changes = 0
    access.onDidChange(() => changes++)
    await access.setEnabled(true)
    await access.setEnabled(true)

    expect(access.bridgePath).toBe(join(dir, 'mcp', 'bridge.js'))
    expect(readFileSync(access.bridgePath, 'utf8')).toBe('// bridge')
    const instances = readInstances(join(dir, 'mcp', 'instances'))
    expect(instances).toHaveLength(1)
    expect(instances[0]).toMatchObject({
      pid: process.pid,
      port: access.running?.port,
      token: access.running?.token,
      workspaceFolders: ['/work/shop'],
    })

    await access.setEnabled(false)
    expect(access.running).toBeUndefined()
    expect(existsSync(join(dir, 'mcp', 'instances', `${process.pid}.json`))).toBe(false)
    expect(changes).toBe(2)
  })

  it('warns instead of throwing when the server cannot start', async () => {
    rmSync(join(dir, 'built-bridge.js'))
    await access.setEnabled(true)
    expect(access.running).toBeUndefined()
    expect(ui.shown).toHaveLength(1)
    expect(ui.shown[0]?.level).toBe('warning')
    expect(ui.shown[0]?.message).toMatch(/^Bulkhead could not start AI agent access: /)
  })

  it('saves through the vault, tells the user and never returns the secret', async () => {
    await access.setEnabled(true)
    const agent = await client()
    const saved = await agent.callTool({
      name: 'save_connection',
      arguments: {
        connectionString: 'postgres://app@db.internal:5432/shop',
        secrets: { password: 's3cret' },
        name: 'shop',
      },
    })
    expect(saved.isError).toBeFalsy()
    const [profile] = profiles.list().profiles
    if (!profile) throw new Error('nothing saved')
    expect(profile.name).toBe('shop')
    expect(secrets.values.get(`bulkhead.connection.${profile.id}.password`)).toBe('s3cret')
    expect(ui.shown).toEqual([
      { level: 'info', message: 'An AI agent added the connection “shop”.' },
    ])

    const listed = await agent.callTool({ name: 'list_connections', arguments: {} })
    expect(JSON.stringify(listed.content)).toContain('app@db.internal:5432/shop')
    expect(JSON.stringify(listed.content)).not.toContain('s3cret')
    await agent.close()
  })

  it('leaves weakening protection to the user, in the form', async () => {
    await profiles.save({
      id: 'prod',
      name: 'orders-prod',
      driver: 'postgres',
      production: true,
      transport: { kind: 'direct' },
      options: { host: 'orders.internal' },
    })
    await access.setEnabled(true)
    const agent = await client()

    const refused = await agent.callTool({
      name: 'save_connection',
      arguments: { connectionId: 'prod', environment: 'development' },
    })
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused.content)).toContain('configure_connection')
    expect(profiles.get('prod')?.production).toBe(true)

    const opened = await agent.callTool({
      name: 'configure_connection',
      arguments: { connectionId: 'prod', environment: 'development' },
    })
    expect(opened.isError).toBeFalsy()
    expect(ui.forms).toHaveLength(1)
    const [existing, proposal] = ui.forms[0] ?? []
    expect(existing?.id).toBe('prod')
    expect(proposal?.warnings).toEqual(['Turns off Production: writes will no longer be blocked.'])
    await agent.close()
  })
})
