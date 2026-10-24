import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { connectionProposalSchema, type ConnectionProposal } from '@bulkhead/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { MCP_PATH } from './discovery'

/** A saved connection as agents see it: no secrets, nothing they could connect with alone. */
export interface ConnectionSummary {
  id: string
  name: string
  driver: string
  environment: 'development' | 'production'
  readOnly: boolean
  /** e.g. `app@db.internal:5432/app`, or why the profile is broken. */
  target: string
}

/** What the tools do; implemented with the VS Code API in `agentAccess.ts`. */
export interface AgentTools {
  listConnections(): Promise<ConnectionSummary[]>
  /** Opens the filled-in connection form; resolves to what to tell the agent. */
  configureConnection(proposal: ConnectionProposal): Promise<string>
  /** Connects read-only once, like the form's Test; resolves to the outcome. */
  testConnection(proposal: ConnectionProposal): Promise<string>
  /** Saves a new connection or changes to a saved one; resolves to what was saved. */
  saveConnection(proposal: ConnectionProposal): Promise<string>
  /** Option keys of every driver, for the tool description. */
  readonly optionsHelp: string
}

export interface RunningMcpServer {
  readonly port: number
  readonly token: string
  readonly url: string
  close(): Promise<void>
}

const INSTRUCTIONS =
  "Bulkhead is the database client in the user's VS Code. You can list the saved connections, " +
  'test and save new ones or changes, with the credentials the user gave you, or open them in ' +
  'the connection form for the user to review. You cannot read saved passwords, run queries, ' +
  'turn off production or read-only protection without the form, or unlock writes on production.'

/**
 * The MCP server of one VS Code window: Streamable HTTP on 127.0.0.1, a random port and a
 * random bearer token per window. Stateless: every POST gets a fresh server, there is no
 * session to hijack and nothing to clean up.
 */
export async function startMcpServer(
  tools: AgentTools,
  version: string,
): Promise<RunningMcpServer> {
  const token = randomBytes(32).toString('base64url')
  const expected = Buffer.from(`Bearer ${token}`)
  let port = 0

  const http = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) reply(response, 500, 'Internal error')
      else response.end()
    })
  })

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    // DNS rebinding: a web page that renamed itself 127.0.0.1 still sends its own Host.
    const host = request.headers.host
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return reply(response, 403, 'Forbidden')
    }
    if (new URL(request.url ?? '/', 'http://127.0.0.1').pathname !== MCP_PATH) {
      return reply(response, 404, 'Not found')
    }
    const given = Buffer.from(request.headers.authorization ?? '')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return reply(response, 401, 'Unauthorized')
    }
    // No sessions, so no server-sent event stream to open (GET) or session to end (DELETE).
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      return reply(response, 405, 'Method not allowed')
    }

    const server = buildServer(tools, version)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    response.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request, response)
  }

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => resolve())
  })
  port = (http.address() as AddressInfo).port

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}${MCP_PATH}`,
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve())
        http.closeAllConnections()
      }),
  }
}

function buildServer(tools: AgentTools, version: string): McpServer {
  const server = new McpServer({ name: 'bulkhead', version }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'list_connections',
    {
      title: 'List database connections',
      description:
        'Saved Bulkhead connections: id, name, database type, environment, read-only and ' +
        'where it points. Passwords are never included.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(JSON.stringify(await tools.listConnections(), null, 2)),
  )

  const call = (run: (proposal: ConnectionProposal) => Promise<string>) => {
    return async (proposal: ConnectionProposal) => {
      try {
        return text(await run(proposal))
      } catch (error) {
        return { ...text(error instanceof Error ? error.message : String(error)), isError: true }
      }
    }
  }
  const options = `Options and secrets per database type:\n${tools.optionsHelp}`

  server.registerTool(
    'configure_connection',
    {
      title: 'Prepare a database connection',
      description:
        'Opens the Bulkhead connection form in VS Code filled in with these values, for a new ' +
        'connection or a change to a saved one (connectionId). Nothing is saved by this call: ' +
        'the user reviews the form, tests and saves it. Use save_connection to save directly. ' +
        'Mark anything that must not be broken as production. ' +
        options,
      inputSchema: connectionProposalSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    call((proposal) => tools.configureConnection(proposal)),
  )

  server.registerTool(
    'test_connection',
    {
      title: 'Test a database connection',
      description:
        'Connects once, read-only, and lists the databases, like the Test button of the form. ' +
        'Pass connectionId alone to test a saved connection, the values of a new one, or both ' +
        'to test changes before saving them. Nothing is saved. ' +
        options,
      inputSchema: connectionProposalSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    call((proposal) => tools.testConnection(proposal)),
  )

  server.registerTool(
    'save_connection',
    {
      title: 'Save a database connection',
      description:
        'Saves a new connection, or changes to a saved one (connectionId), without opening the ' +
        'form; returns its id. Secrets go to VS Code SecretStorage. Test it first with ' +
        'test_connection. Mark anything that must not be broken as production. Turning off ' +
        'production or read-only is refused here: use configure_connection so the user ' +
        'confirms it. ' +
        options,
      inputSchema: connectionProposalSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    call((proposal) => tools.saveConnection(proposal)),
  )

  return server
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] }
}

function reply(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'text/plain' }).end(message)
}
