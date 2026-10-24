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

window.acquireVsCodeApi = () => ({
  getState() {},
  setState() {},
  postMessage(message) {
    posted.push(message)
    switch (message.type) {
      case 'ready':
        if (scenario.results) scenario.results.forEach((item) => reply(item))
        else if (scenario.app === 'connection-form')
          reply({ type: 'init', drivers, start: scenario.start })
        break
      case 'parse':
        reply({ type: 'parsed', requestId: message.requestId, result: parse(message.text) })
        break
      case 'test': {
        const refused = message.draft.options.host === 'nowhere'
        reply(
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
  },
})
