import type { ConnectionProposal } from '@bulkhead/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { relay } from './relay'
import { startMcpServer, type AgentTools, type RunningMcpServer } from './server'

const proposals: ConnectionProposal[] = []
const saved: ConnectionProposal[] = []
const tools: AgentTools = {
  listConnections: () =>
    Promise.resolve([
      {
        id: 'a',
        name: 'orders-prod',
        driver: 'postgres',
        environment: 'production',
        readOnly: true,
        target: 'reader@orders.internal:5432/shop',
      },
    ]),
  configureConnection: (proposal) => {
    if (proposal.connectionId === 'missing') return Promise.reject(new Error('No such connection'))
    proposals.push(proposal)
    return Promise.resolve('Opened the form.')
  },
  testConnection: (proposal) =>
    proposal.options?.host === 'down'
      ? Promise.reject(new Error('Could not connect: ECONNREFUSED'))
      : Promise.resolve('Connected read-only in 3 ms. Databases: shop.'),
  saveConnection: (proposal) => {
    saved.push(proposal)
    return Promise.resolve('Saved "shop" (id new-id).')
  },
  optionsHelp: 'postgres: host (string)',
}

let server: RunningMcpServer
beforeEach(async () => {
  proposals.length = 0
  saved.length = 0
  server = await startMcpServer(tools, '0.0.0-test')
})
afterEach(() => server.close())

const connect = async (headers: Record<string, string>) => {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }),
  )
  return client
}
const authorized = () => connect({ authorization: `Bearer ${server.token}` })

describe('MCP server', () => {
  it('lists the tools and describes the options', async () => {
    const client = await authorized()
    const { tools: listed } = await client.listTools()
    expect(listed.map((tool) => tool.name).sort()).toEqual([
      'configure_connection',
      'list_connections',
      'save_connection',
      'test_connection',
    ])
    for (const name of ['configure_connection', 'test_connection', 'save_connection']) {
      const tool = listed.find((candidate) => candidate.name === name)
      expect(tool?.description).toContain('postgres: host (string)')
      expect(Object.keys(tool?.inputSchema.properties ?? {})).toContain('secrets')
    }
    expect(client.getInstructions()).toContain('cannot read saved passwords')
    await client.close()
  })

  it('returns connections and passes proposals through', async () => {
    const client = await authorized()
    const listed = await client.callTool({ name: 'list_connections', arguments: {} })
    expect(JSON.stringify(listed.content)).toContain('orders-prod')

    const opened = await client.callTool({
      name: 'configure_connection',
      arguments: { name: 'shop', environment: 'production', options: { host: 'db' } },
    })
    expect(opened.isError).toBeFalsy()
    expect(proposals).toEqual([
      { name: 'shop', environment: 'production', options: { host: 'db' } },
    ])

    const refused = await client.callTool({
      name: 'configure_connection',
      arguments: { connectionId: 'missing' },
    })
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused.content)).toContain('No such connection')

    const invalid = await client.callTool({
      name: 'configure_connection',
      arguments: { environment: 'staging' },
    })
    expect(invalid.isError).toBe(true)
    expect(proposals).toHaveLength(1)
    await client.close()
  })

  it('tests and saves through the tools and reports failures as tool errors', async () => {
    const client = await authorized()
    const tested = await client.callTool({
      name: 'test_connection',
      arguments: { options: { host: 'db' }, secrets: { password: 'p' } },
    })
    expect(tested.isError).toBeFalsy()
    expect(JSON.stringify(tested.content)).toContain('Databases: shop')

    const down = await client.callTool({
      name: 'test_connection',
      arguments: { options: { host: 'down' } },
    })
    expect(down.isError).toBe(true)
    expect(JSON.stringify(down.content)).toContain('ECONNREFUSED')

    const stored = await client.callTool({
      name: 'save_connection',
      arguments: { name: 'shop', secrets: { password: 'p' } },
    })
    expect(stored.isError).toBeFalsy()
    expect(saved).toEqual([{ name: 'shop', secrets: { password: 'p' } }])

    const invalid = await client.callTool({
      name: 'save_connection',
      arguments: { secrets: { password: 1 } },
    })
    expect(invalid.isError).toBe(true)
    expect(saved).toHaveLength(1)
    await client.close()
  })

  it('refuses requests without the token, with a foreign Host, or on another path', async () => {
    await expect(connect({})).rejects.toThrow()
    await expect(connect({ authorization: 'Bearer wrong' })).rejects.toThrow()

    const post = (url: string, headers: Record<string, string>) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: '{}',
      })
    const auth = { authorization: `Bearer ${server.token}` }
    expect((await post(server.url, {})).status).toBe(401)
    expect((await post(server.url.replace('/mcp', '/other'), auth)).status).toBe(404)
    // Node's fetch does not let us forge Host, so check the raw request instead.
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const forged = request(
        server.url,
        { method: 'POST', headers: { ...auth, host: 'evil.example:80' } },
        (response) => resolve(response.statusCode ?? 0),
      )
      forged.on('error', reject)
      forged.end('{}')
    })
    expect(status).toBe(403)
    const get = await fetch(server.url, { headers: auth })
    expect(get.status).toBe(405)
  })
})

describe('relay (the stdio bridge)', () => {
  const instance = () => ({
    pid: process.pid,
    port: server.port,
    token: server.token,
    workspaceFolders: [],
    startedAt: 0,
  })
  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    },
  })

  it('forwards requests and returns the answers', async () => {
    const [answer] = await relay(initialize, instance)
    expect(JSON.parse(answer!)).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'bulkhead' } },
    })

    const notification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(await relay(notification, instance)).toEqual([])

    const call = JSON.stringify({
      jsonrpc: '2.0',
      id: 'x',
      method: 'tools/call',
      params: { name: 'list_connections', arguments: {} },
    })
    const [listed] = await relay(call, instance)
    expect(JSON.parse(listed!)).toMatchObject({ id: 'x' })
    expect(listed).toContain('orders-prod')
  })

  it('answers with an error when no window runs or the token is stale', async () => {
    const [missing] = await relay(initialize, () => undefined)
    expect(JSON.parse(missing!)).toMatchObject({ id: 1, error: { code: -32000 } })
    expect(missing).toContain('Bulkhead is not running')

    const [stale] = await relay(initialize, () => ({ ...instance(), token: 'old' }))
    expect(stale).toContain('401')

    expect(await relay('not json', instance)).toEqual([
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
    ])
  })
})
