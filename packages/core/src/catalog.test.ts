import { describe, expect, it } from 'vitest'

import { CATALOG, catalogEntryForHost, searchCatalog } from './catalog'
import { DRIVER_KINDS } from './connection'

describe('catalog', () => {
  it('has unique ids and only known drivers', () => {
    expect(new Set(CATALOG.map((entry) => entry.id)).size).toBe(CATALOG.length)
    for (const entry of CATALOG) {
      if (entry.driver) expect(DRIVER_KINDS).toContain(entry.driver)
      expect(entry.group === 'planned').toBe(entry.driver === null)
    }
  })

  it('searches labels and keywords, every word must match', () => {
    expect(searchCatalog('').length).toBe(CATALOG.length)
    expect(searchCatalog('aws').map((entry) => entry.id)).toEqual(['aws-rds'])
    expect(searchCatalog('NEON').map((entry) => entry.id)).toEqual(['neon'])
    expect(searchCatalog('postgres google').map((entry) => entry.id)).toEqual(['cloud-sql'])
    expect(searchCatalog('mongodb')).toEqual([])
  })

  it('recognises hosted services by host name', () => {
    const id = (host: unknown) => catalogEntryForHost(host)?.id
    expect(id('ep-cool-darkness-123456.eu-central-1.aws.neon.tech')).toBe('neon')
    expect(id('DB.ABCDEFGH.SUPABASE.CO')).toBe('supabase')
    expect(id('orders.c9akciq32.eu-west-1.rds.amazonaws.com')).toBe('aws-rds')
    expect(id('dpg-abc123-a.oregon-postgres.render.com')).toBe('render')
    expect(id('neon.tech.example.com')).toBeUndefined()
    expect(id('localhost')).toBeUndefined()
    expect(id(undefined)).toBeUndefined()
  })
})
