/**
 * Stands in for the extension host inside the preview page: answers the webview's messages from
 * the scenario in `window.__PREVIEW__`. Connection strings go through the real driver parser, so
 * the preview shows what the extension would do.
 */
import { parsePostgresConnectionString } from '../../packages/driver-postgres/src/connectionString'
import { postgresOptionFields } from '../../packages/driver-postgres/src/options'

const scenario = window.__PREVIEW__
const posted = []
window.__posted = posted

const reply = (message, delay = 0) => setTimeout(() => window.postMessage(message, '*'), delay)

const drivers = [
  {
    kind: 'postgres',
    displayName: 'PostgreSQL',
    optionFields: postgresOptionFields,
    secretFields: [{ key: 'password', label: 'Password', optional: true }],
  },
]

function parse(text) {
  try {
    const parsed = parsePostgresConnectionString(text)
    return parsed ? { ok: true, driver: 'postgres', ...parsed } : null
  } catch (error) {
    return { ok: false, message: error.message }
  }
}

/** Answers one results or form message the way the host would; `send` delivers a reply. */
function handle(message, send) {
  posted.push(message)
  switch (message.type) {
    case 'ready':
      if (scenario.results) scenario.results.forEach((item) => send(item))
      else if (scenario.app === 'connection-form' || scenario.orca?.state.view === 'form')
        send({ type: 'init', drivers, start: scenario.start })
      break
    case 'parse':
      send({ type: 'parsed', requestId: message.requestId, result: parse(message.text) })
      break
    case 'test': {
      const refused = message.draft.options.host === 'nowhere'
      send(
        {
          type: 'test-result',
          requestId: message.requestId,
          result: refused
            ? {
                ok: false,
                message: 'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
              }
            : { ok: true, durationMs: 84, databases: ['bulkhead', 'postgres', 'shop'] },
        },
        150,
      )
      break
    }
  }
}

if (scenario.orca) {
  // An Orca panel: a frame API (`window.orca`) instead of `acquireVsCodeApi`, see
  // packages/webview/src/orca/bridge.ts. Requests are answered from `scenario.orca`.
  const listeners = new Map()
  const emit = (event, payload, delay = 0) =>
    setTimeout(() => (listeners.get(event) ?? []).forEach((handler) => handler(payload)), delay)
  const answers = {
    'bulkhead.state': () => scenario.orca.state,
    'bulkhead.children': ({ node }) => scenario.orca.children?.[node?.id ?? ''] ?? [],
    'bulkhead.webview': (message) =>
      handle(message, (reply, delay) => emit('bulkhead.webview', { message: reply }, delay)),
  }
  window.orca = {
    plugin: {
      // `bulkhead.webview` answers bare, like the worker; the rest as `PanelReply`.
      request: async (name, input) =>
        name === 'bulkhead.webview'
          ? answers[name](input)
          : scenario.orca.fail?.[name]
            ? { ok: false, message: scenario.orca.fail[name] }
            : { ok: true, value: answers[name]?.(input) ?? null },
      on(event, handler) {
        listeners.set(event, [...(listeners.get(event) ?? []), handler])
        return { dispose: () => undefined }
      },
    },
    host: { call: async () => null },
    on: () => ({ dispose: () => undefined }),
  }
  // An editor tab: the open file, as `orca.document` gives it.
  if (scenario.orca.document !== undefined) {
    const text = scenario.orca.document
    const content = { kind: 'text', text }
    window.orca.document = {
      get: async () => ({ content }),
      onDidChange(handler) {
        setTimeout(() => handler({ content }))
        return { dispose: () => undefined }
      },
      session: async () => ({
        value: text,
        readOnly: false,
        change: () => undefined,
        flush: async () => undefined,
        onReplace: () => ({ dispose: () => undefined }),
        dispose: () => undefined,
      }),
    }
  }
  if (scenario.orca.ask) emit('bulkhead.on.ask', scenario.orca.ask, 300)
} else {
  window.acquireVsCodeApi = () => ({
    getState() {},
    setState() {},
    postMessage: (message) => handle(message, reply),
  })
}
