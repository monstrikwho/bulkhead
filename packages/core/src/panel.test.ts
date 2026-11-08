import { describe, expect, it } from 'vitest'

import { formatConsoleFile, parseConsoleFile, parseTableFile } from './panel'

describe('console files', () => {
  it('round-trips the connection and the SQL', () => {
    const text = formatConsoleFile({ connectionId: 'abc-1', sql: 'select 1;\n' }, 'orders\nprod')
    expect(text).toBe('-- bulkhead connection: abc-1 (orders prod)\nselect 1;\n')
    expect(parseConsoleFile(text)).toEqual({ connectionId: 'abc-1', sql: 'select 1;\n' })
  })

  it('reads a file without a header as SQL with no connection', () => {
    expect(parseConsoleFile('select 1')).toEqual({ sql: 'select 1' })
    expect(parseConsoleFile('')).toEqual({ sql: '' })
    expect(formatConsoleFile({ sql: 'select 1' })).toBe('select 1')
  })

  it('accepts a header with nothing after it', () => {
    expect(parseConsoleFile('-- bulkhead connection: x')).toEqual({ connectionId: 'x', sql: '' })
  })
})

describe('table files', () => {
  it('accepts what the worker writes and refuses anything else', () => {
    const file = {
      bulkhead: 'table',
      connectionId: 'c',
      title: 'public.orders',
      database: 'shop',
      query: 'SELECT * FROM "public"."orders"',
    }
    expect(parseTableFile(JSON.stringify(file))).toEqual(file)
    expect(parseTableFile('not json')).toBeUndefined()
    expect(parseTableFile(JSON.stringify({ ...file, bulkhead: 'other' }))).toBeUndefined()
    expect(parseTableFile(JSON.stringify({ ...file, query: 1 }))).toBeUndefined()
  })
})
