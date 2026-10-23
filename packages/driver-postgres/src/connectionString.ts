import { ConfigError, type ParsedConnectionString } from '@bulkhead/core'

import type { SslMode } from './options'

const URL_PREFIX = /^(?:jdbc:)?postgres(?:ql)?:\/\//i
const KEYWORD_PAIR = /^\s*[a-z_]+\s*=/i

/**
 * Reads what people copy from dashboards and `.env` files:
 * - URLs: `postgres://user:pass@host:5432/db?sslmode=require`, also `postgresql://` and `jdbc:`;
 * - libpq keyword strings: `host=db port=5432 dbname=app user=app sslmode=require`.
 * Returns `undefined` for anything else.
 */
export function parsePostgresConnectionString(text: string): ParsedConnectionString | undefined {
  const input = text.trim()
  if (URL_PREFIX.test(input)) return fromUrl(input.replace(/^jdbc:/i, ''))
  if (KEYWORD_PAIR.test(input) && /\b(host|dbname|user)\s*=/.test(input)) {
    return fromParameters(parseKeywords(input))
  }
  return undefined
}

function fromUrl(input: string): ParsedConnectionString {
  // Several hosts (`host1,host2`) are a libpq failover list; the URL parser cannot read them.
  const authority = input.slice(input.indexOf('//') + 2).split(/[/?#]/, 1)[0] ?? ''
  if (authority.slice(authority.lastIndexOf('@') + 1).includes(',')) {
    throw new ConfigError('Connection strings with several hosts are not supported.')
  }
  let url: URL
  try {
    url = new URL(input.replace(URL_PREFIX, 'postgres://'))
  } catch {
    throw new ConfigError('This does not look like a valid PostgreSQL URL.')
  }

  const parameters = new Map<string, string>()
  const hostname = url.hostname.replace(/^\[(.*)]$/, '$1')
  if (hostname) parameters.set('host', decodeURIComponent(hostname))
  if (url.port) parameters.set('port', url.port)
  if (url.username) parameters.set('user', decodeURIComponent(url.username))
  if (url.password) parameters.set('password', decodeURIComponent(url.password))
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (database) parameters.set('dbname', database)
  // Query parameters may override the parts above, as in libpq.
  for (const [key, value] of url.searchParams) parameters.set(key, value)
  return fromParameters(parameters)
}

function fromParameters(parameters: Map<string, string>): ParsedConnectionString {
  const options: Record<string, unknown> = {}
  const secrets: Record<string, string> = {}

  const host = parameters.get('host') ?? parameters.get('hostaddr')
  if (host?.startsWith('/')) {
    throw new ConfigError('Unix sockets are not supported yet; connect over TCP.')
  }
  if (host) options.host = host
  const port = parameters.get('port')
  if (port) {
    const number = Number(port)
    if (!Number.isInteger(number) || number < 1 || number > 65535) {
      throw new ConfigError(`Invalid port "${port}".`)
    }
    options.port = number
  }
  const database = parameters.get('dbname') ?? parameters.get('database')
  if (database) options.database = database
  const user = parameters.get('user')
  if (user) options.user = user
  const password = parameters.get('password')
  if (password) secrets.password = password
  const ssl = sslModeOf(
    parameters.get('sslmode') ?? (parameters.get('ssl') === 'true' ? 'require' : undefined),
  )
  if (ssl) options.ssl = ssl

  return { options, secrets }
}

/**
 * Maps libpq `sslmode` onto Bulkhead's modes, never weaker than asked: `prefer` and `allow`
 * become `require`, and `verify-ca` becomes `verify-full`, which also checks the host name.
 */
function sslModeOf(mode: string | undefined): SslMode | undefined {
  switch (mode?.toLowerCase()) {
    case undefined:
      return undefined
    case 'disable':
      return 'disable'
    case 'allow':
    case 'prefer':
    case 'require':
      return 'require'
    case 'verify-ca':
    case 'verify-full':
      return 'verify-full'
    default:
      throw new ConfigError(`Unknown sslmode "${mode}".`)
  }
}

/** `key=value key='quoted \' value'`, as documented for libpq connection strings. */
function parseKeywords(input: string): Map<string, string> {
  const parameters = new Map<string, string>()
  const pattern = /([a-z_]+)\s*=\s*('(?:[^'\\]|\\.)*'|\S*)/giy
  let rest = input.trim()
  while (rest) {
    pattern.lastIndex = 0
    const match = pattern.exec(rest)
    if (!match) throw new ConfigError(`Cannot read the connection string near "${rest}".`)
    const [whole, key, raw = ''] = match
    const value = raw.startsWith("'") ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw
    parameters.set(key!.toLowerCase(), value)
    rest = rest.slice(whole.length).trimStart()
  }
  return parameters
}
