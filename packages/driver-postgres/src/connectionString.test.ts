import { ConfigError } from '@bulkhead/core'
import { describe, expect, it } from 'vitest'

import { parsePostgresConnectionString as parse } from './connectionString'
import { parsePostgresOptions } from './options'

describe('parsePostgresConnectionString', () => {
  it('reads a full URL', () => {
    expect(parse('postgres://app:s3cret@db.internal:6432/shop?sslmode=require')).toEqual({
      options: { host: 'db.internal', port: 6432, user: 'app', database: 'shop', ssl: 'require' },
      secrets: { password: 's3cret' },
    })
  })

  it('decodes percent-encoded user, password and database', () => {
    const parsed = parse('postgresql://me%40corp:p%40ss%2Fw0rd@localhost/my%20db')
    expect(parsed?.options).toMatchObject({ user: 'me@corp', database: 'my db' })
    expect(parsed?.secrets).toEqual({ password: 'p@ss/w0rd' })
  })

  it('accepts JDBC URLs, IPv6 hosts and surrounding whitespace', () => {
    expect(parse('  jdbc:postgresql://[::1]:5433/app\n')?.options).toEqual({
      host: '::1',
      port: 5433,
      database: 'app',
    })
  })

  it('lets query parameters override the URL, as libpq does', () => {
    expect(parse('postgres://a@h/db?user=b&dbname=other')?.options).toMatchObject({
      user: 'b',
      database: 'other',
    })
  })

  it('never weakens SSL', () => {
    const ssl = (mode: string) => parse(`postgres://h/db?sslmode=${mode}`)?.options.ssl
    expect(ssl('disable')).toBe('disable')
    expect(ssl('prefer')).toBe('require')
    expect(ssl('allow')).toBe('require')
    expect(ssl('verify-ca')).toBe('verify-full')
    expect(() => ssl('sometimes')).toThrow(ConfigError)
  })

  it('reads libpq keyword strings with quoted values', () => {
    expect(
      parse(
        "host=db.internal port=5432 dbname=app user=app password='it\\'s secret' sslmode=require",
      ),
    ).toEqual({
      options: { host: 'db.internal', port: 5432, database: 'app', user: 'app', ssl: 'require' },
      secrets: { password: "it's secret" },
    })
  })

  it('produces options the driver accepts', () => {
    const parsed = parse('postgres://app@db/app')!
    expect(parsePostgresOptions(parsed.options)).toMatchObject({ host: 'db', port: 5432 })
  })

  it('refuses what it cannot represent', () => {
    expect(() => parse('postgres://h1,h2/db')).toThrow(/several hosts/)
    expect(() => parse('postgres://u@h:99999/db')).toThrow(ConfigError)
    expect(() => parse('host=/var/run/postgresql dbname=app')).toThrow(/Unix sockets/)
  })

  it('ignores text that is not a PostgreSQL connection string', () => {
    expect(parse('neon')).toBeUndefined()
    expect(parse('mysql://root@localhost/db')).toBeUndefined()
    expect(parse('redis://localhost:6379')).toBeUndefined()
    expect(parse('')).toBeUndefined()
  })
})
