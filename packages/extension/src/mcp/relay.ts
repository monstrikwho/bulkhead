import { MCP_PATH, type McpInstance } from './discovery'

/**
 * One JSON-RPC message from a stdio MCP client, forwarded to the HTTP server of a Bulkhead
 * window. Resolves to the messages to write back, one per line. The window is looked up for
 * every message, so the bridge survives VS Code restarts without restarting the agent.
 */
export async function relay(
  line: string,
  findInstance: () => McpInstance | undefined,
): Promise<string[]> {
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    return [failure(null, -32700, 'Parse error')]
  }
  // Notifications and responses carry no id and need no answer.
  const id = idOf(message)

  const instance = findInstance()
  if (!instance) {
    return id === undefined
      ? []
      : [
          failure(
            id,
            -32000,
            'Bulkhead is not running. Open VS Code with the Bulkhead extension installed, ' +
              'ideally on the folder this agent works in.',
          ),
        ]
  }

  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${instance.port}${MCP_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${instance.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: line,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return id === undefined ? [] : [failure(id, -32000, `Bulkhead did not answer: ${reason}`)]
  }

  const body = await response.text()
  if (response.ok && body.trim()) {
    const parsed: unknown = JSON.parse(body)
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => JSON.stringify(item))
  }
  if (response.ok || id === undefined) return []
  return [failure(id, -32000, `Bulkhead answered ${response.status}: ${body.slice(0, 200)}`)]
}

type Id = string | number | null

function idOf(message: unknown): Id | undefined {
  if (typeof message !== 'object' || message === null || !('method' in message)) return undefined
  const id = (message as { id?: unknown }).id
  return typeof id === 'string' || typeof id === 'number' ? id : undefined
}

function failure(id: Id, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}
