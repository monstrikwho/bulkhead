import { describe, expect, it } from 'vitest'

import { describeDriverOptions, proposeDraft } from './agent'
import { ConfigError } from './connection'
import type { ConnectionDraft, DriverDescriptor } from './connectionForm'

const driver: DriverDescriptor = {
  kind: 'postgres',
  displayName: 'PostgreSQL',
  optionFields: [
    { key: 'host', label: 'Host', kind: 'string', default: 'localhost' },
    { key: 'port', label: 'Port', kind: 'number', default: 5432 },
    { key: 'user', label: 'User', kind: 'string' },
    { key: 'ssl', label: 'SSL', kind: 'enum', values: ['disable', 'require'], default: 'disable' },
    { key: 'showSystemSchemas', label: 'System schemas', kind: 'boolean', default: false },
  ],
  secretFields: [{ key: 'password', label: 'Password', optional: true }],
}

const saved: ConnectionDraft = {
  id: 'orders',
  name: 'orders-prod',
  driver: 'postgres',
  production: true,
  readOnly: false,
  options: { host: 'orders.internal', port: '5432', user: 'reader', ssl: 'require' },
  secrets: {},
}

describe('proposeDraft', () => {
  it('fills a new connection over the driver and hosted-service defaults', () => {
    const { draft, changed, warnings } = proposeDraft({
      proposal: { name: ' neon ', options: { host: 'ep-x.eu-central-1.aws.neon.tech' } },
      driver,
    })
    expect(draft).toStrictEqual({
      name: 'neon',
      driver: 'postgres',
      production: false,
      readOnly: false,
      options: {
        host: 'ep-x.eu-central-1.aws.neon.tech',
        port: 5432,
        ssl: 'verify-full',
        showSystemSchemas: false,
        database: 'neondb',
      },
      secrets: {},
    })
    expect(draft.id).toBeUndefined()
    expect(changed).toEqual([])
    expect(warnings).toEqual([])
  })

  it('lets explicit options win over the connection string', () => {
    const { draft } = proposeDraft({
      proposal: { options: { port: '6543' }, environment: 'production' },
      driver,
      parsed: { options: { host: 'db', port: 5432, user: 'app' }, secrets: { password: 's3cret' } },
    })
    expect(draft.options).toMatchObject({ host: 'db', port: 6543, user: 'app' })
    expect(draft.secrets).toEqual({ password: 's3cret' })
    expect(draft.production).toBe(true)
    expect(draft.readOnly).toBe(true)
  })

  it('takes secrets over the connection string and refuses unknown ones', () => {
    const { draft } = proposeDraft({
      proposal: { secrets: { password: 'given' } },
      driver,
      parsed: { options: { host: 'db' }, secrets: { password: 'from-url' } },
    })
    expect(draft.secrets).toEqual({ password: 'given' })
    expect(() => proposeDraft({ proposal: { secrets: { token: 'x' } }, driver })).toThrow(
      /no secret "token". Known: password/,
    )
  })

  it('lists what changed on a saved connection and keeps its id', () => {
    const { draft, changed, warnings } = proposeDraft({
      proposal: { options: { host: 'orders-replica.internal', port: 5432 } },
      driver,
      existing: saved,
    })
    expect(draft.id).toBe('orders')
    expect(draft.name).toBe('orders-prod')
    // "5432" in settings and 5432 from the agent are the same port.
    expect(changed).toEqual(['Host'])
    expect(warnings).toEqual([])
  })

  it('warns when production or read-only is turned off', () => {
    const toDevelopment = proposeDraft({
      proposal: { environment: 'development' },
      driver,
      existing: saved,
    })
    expect(toDevelopment.draft.readOnly).toBe(false)
    expect(toDevelopment.changed).toEqual(['Environment', 'Read-only'])
    expect(toDevelopment.warnings).toEqual([
      'Turns off Production: writes will no longer be blocked.',
    ])

    const writable = proposeDraft({
      proposal: { readOnly: false },
      driver,
      existing: { ...saved, production: false, readOnly: true },
    })
    expect(writable.warnings).toEqual(['Turns off Read-only: writes will be allowed.'])
  })

  it('cannot make a production connection writable with readOnly: false', () => {
    const { draft, changed } = proposeDraft({
      proposal: { readOnly: false },
      driver,
      existing: saved,
    })
    expect(draft.readOnly).toBe(true)
    expect(changed).toEqual([])
  })

  it('refuses unknown options and values of the wrong type', () => {
    const propose = (options: Record<string, unknown>) =>
      proposeDraft({ proposal: { options }, driver })
    expect(() => propose({ hostname: 'db' })).toThrow(ConfigError)
    expect(() => propose({ hostname: 'db' })).toThrow(/Known: host, port/)
    expect(() => propose({ port: 'abc' })).toThrow(/must be a number/)
    expect(() => propose({ ssl: 'prefer' })).toThrow(/one of disable, require/)
    expect(() => propose({ showSystemSchemas: 'yes' })).toThrow(/true or false/)
  })
})

describe('describeDriverOptions', () => {
  it('names every option with its type and default', () => {
    expect(describeDriverOptions([driver])).toBe(
      'postgres: host (string, default localhost), port (number, default 5432), user (string), ' +
        'ssl (disable|require, default disable), showSystemSchemas (boolean, default false); ' +
        'secrets: password',
    )
  })
})
