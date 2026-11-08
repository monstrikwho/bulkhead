/**
 * Runs against the local stand: `pnpm dev:db`, then `pnpm test:integration`.
 * Override the target with BULKHEAD_PG_URL (CI uses a service container).
 */
import { parseConnectionProfile, type AccessMode, type DriverSession } from '@bulkhead/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { postgresDriver } from '../src'

const url = new URL(
  process.env.BULKHEAD_PG_URL ?? 'postgres://bulkhead:bulkhead@127.0.0.1:55432/bulkhead',
)

async function connect(
  accessMode: AccessMode,
  login = { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) },
): Promise<DriverSession> {
  const profile = parseConnectionProfile({
    id: `test-${accessMode}`,
    name: 'test',
    driver: 'postgres',
    production: accessMode === 'read-only',
    options: {
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: login.user,
    },
  })
  const options = postgresDriver.parseOptions(profile.options)
  return postgresDriver.connect({
    profile,
    options,
    endpoint: postgresDriver.target(options),
    secrets: { password: login.password },
    accessMode,
  })
}

const run = (session: DriverSession, script: string, maxRows = 1000) =>
  session.execute(script, { maxRows })

let writer: DriverSession
let reader: DriverSession

beforeAll(async () => {
  writer = await connect('read-write')
  reader = await connect('read-only')
  // A function that writes behind a SELECT: invisible to any client-side classifier.
  await run(
    writer,
    `create table if not exists public.bulkhead_audit (id serial primary key, note text);
     create or replace function public.bulkhead_write() returns int language sql as
       $$ insert into public.bulkhead_audit (note) values ('written') returning id $$`,
  )
})

afterAll(async () => {
  await run(
    writer,
    'drop function if exists public.bulkhead_write(); drop table if exists public.bulkhead_audit',
  )
  await Promise.all([writer?.close(), reader?.close()])
})

async function auditCount(): Promise<string> {
  const [outcome] = await run(writer, 'select count(*) from public.bulkhead_audit')
  if (outcome?.kind !== 'rows') throw new Error(`unexpected outcome ${JSON.stringify(outcome)}`)
  return outcome.rows[0]![0] as string
}

describe('read-only mode', () => {
  it('allows reads', async () => {
    const [outcome] = await run(reader, 'select count(*) from shop.customers')
    expect(outcome).toMatchObject({ kind: 'rows', rows: [['500']] })
  })

  it('refuses writes before they reach the server', async () => {
    const outcomes = await run(reader, 'delete from shop.orders')
    expect(outcomes).toMatchObject([{ kind: 'error', blockedBy: 'guard' }])
  })

  it('does not let a read smuggle a write in the same script', async () => {
    const before = await auditCount()
    const outcomes = await run(
      reader,
      'select 1; insert into public.bulkhead_audit (note) values (1)',
    )
    expect(outcomes.map((o) => o.kind)).toEqual(['rows', 'error'])
    expect(outcomes[1]).toMatchObject({ blockedBy: 'guard' })
    expect(await auditCount()).toBe(before)
  })

  it('refuses a write hidden in a function call at the database layer', async () => {
    const before = await auditCount()
    const outcomes = await run(reader, 'select public.bulkhead_write()')
    expect(outcomes).toMatchObject([{ kind: 'error', blockedBy: 'database', code: '25006' }])
    expect(await auditCount()).toBe(before)
  })

  it('refuses nextval, which the classifier cannot see', async () => {
    const outcomes = await run(reader, "select nextval('shop.ticket_seq')")
    expect(outcomes).toMatchObject([{ kind: 'error', blockedBy: 'database' }])
  })

  it('refuses switching the transaction to read-write', async () => {
    const outcomes = await run(reader, "select set_config('transaction_read_only', 'off', true)")
    expect(outcomes[0]?.kind).toBe('error')
  })

  it('does not let a session setting outlive its statement', async () => {
    const before = await auditCount()
    await run(reader, "select set_config('default_transaction_read_only', 'off', false)")
    const outcomes = await run(reader, 'select public.bulkhead_write()')
    expect(outcomes).toMatchObject([{ kind: 'error', blockedBy: 'database' }])
    expect(await auditCount()).toBe(before)
  })

  it.each(['set default_transaction_read_only = off', 'begin read write', 'commit'])(
    'refuses %s',
    async (sql) => {
      expect(await run(reader, sql)).toMatchObject([{ kind: 'error', blockedBy: 'guard' }])
    },
  )
})

describe('read-write mode', () => {
  it('runs writes and reports the command', async () => {
    const outcomes = await run(
      writer,
      'select public.bulkhead_write(); delete from public.bulkhead_audit',
    )
    expect(outcomes[1]).toMatchObject({ kind: 'command', command: 'DELETE' })
  })

  it('keeps a transaction open across runs on the same session', async () => {
    await run(writer, "begin; insert into public.bulkhead_audit (note) values ('tx')")
    const inside = await run(writer, "select count(*) from public.bulkhead_audit where note = 'tx'")
    await run(writer, 'rollback')
    expect(inside).toMatchObject([{ kind: 'rows', rows: [['1']] }])
    expect(
      await run(writer, "select count(*) from public.bulkhead_audit where note = 'tx'"),
    ).toMatchObject([{ rows: [['0']] }])
  })
})

describe('results', () => {
  it('fetches at most maxRows and flags truncation', async () => {
    const [outcome] = await run(reader, 'select * from shop.orders', 100)
    expect(outcome).toMatchObject({ kind: 'rows', truncated: true })
    expect(outcome?.kind === 'rows' && outcome.rows).toHaveLength(100)
  })

  it('keeps server text for values that JavaScript would distort', async () => {
    const [outcome] = await run(
      reader,
      `select 9007199254740993::bigint as big, 1.10::numeric as num, true as flag, 42 as int,
              null::text as nothing, '2026-01-01 10:00+00'::timestamptz at time zone 'UTC' as ts`,
    )
    expect(outcome).toMatchObject({
      kind: 'rows',
      rows: [['9007199254740993', '1.10', true, 42, null, '2026-01-01 10:00:00']],
    })
    expect(outcome?.kind === 'rows' && outcome.columns.map((c) => c.type)).toEqual([
      'bigint',
      'numeric',
      'boolean',
      'integer',
      'text',
      'timestamp without time zone',
    ])
    expect(outcome?.kind === 'rows' && outcome.columns.map((c) => c.numeric)).toEqual([
      true,
      true,
      false,
      true,
      false,
      false,
    ])
  })

  it('stops at the first error', async () => {
    const outcomes = await run(reader, 'select 1; select * from missing_table; select 3')
    expect(outcomes.map((o) => o.kind)).toEqual(['rows', 'error'])
  })

  it('cancels a running statement', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const outcomes = await reader.execute('select pg_sleep(10)', {
      maxRows: 10,
      signal: controller.signal,
    })
    expect(outcomes).toMatchObject([{ kind: 'error', code: '57014' }])
  })
})

describe('explorer', () => {
  it('walks database → schema → table → columns', async () => {
    const databases = await reader.listChildren()
    const database = databases.find((n) => n.label === url.pathname.slice(1))!
    const schema = (await reader.listChildren(database)).find((n) => n.label === 'shop')!
    const relations = await reader.listChildren(schema)
    expect(relations.map((n) => [n.label, n.kind])).toEqual([
      ['customers', 'table'],
      ['orders', 'table'],
      ['order_totals', 'view'],
    ])
    const customers = relations[0]!
    expect(customers.description).toBe('≈ 500 rows')
    expect(customers.previewQuery).toBe('SELECT * FROM "shop"."customers"')

    const [columnsFolder, indexesFolder] = await reader.listChildren(customers)
    const columns = await reader.listChildren(columnsFolder)
    expect(columns[0]).toMatchObject({ label: 'id', icon: 'key', description: 'bigint · not null' })
    const indexes = await reader.listChildren(indexesFolder)
    expect(indexes.map((n) => n.description)).toEqual(['primary key', 'unique'])
  })

  it('leaves optional fields out instead of setting them to undefined', async () => {
    // Orca's panel bridge refuses a reply with an explicit `undefined` anywhere in it.
    const databases = await reader.listChildren()
    const database = databases.find((n) => n.label === url.pathname.slice(1))!
    const schema = (await reader.listChildren(database)).find((n) => n.label === 'shop')!
    const relations = await reader.listChildren(schema)
    const view = relations.find((n) => n.kind === 'view')!
    expect(Object.keys(view)).not.toContain('description')
    const [, indexesFolder] = await reader.listChildren(relations[0])
    const nodes = [databases, relations, await reader.listChildren(indexesFolder)].flat()
    for (const node of nodes) {
      for (const [key, value] of Object.entries(node)) {
        expect(value, `${node.id}.${key}`).not.toBeUndefined()
      }
    }
  })
})

describe('column privileges', () => {
  // Production roles often may read only some columns (secrets revoked); SELECT * then fails.
  const role = 'bulkhead_columns'
  let limited: DriverSession

  beforeAll(async () => {
    await run(
      writer,
      `drop role if exists ${role};
       create role ${role} login password '${role}';
       grant usage on schema shop to ${role};
       grant select (id, email) on shop.customers to ${role};`,
    )
    limited = await connect('read-only', { user: role, password: role })
  })

  afterAll(async () => {
    await limited?.close()
    await run(writer, `drop owned by ${role}; drop role if exists ${role}`)
  })

  async function relations() {
    const databases = await limited.listChildren()
    const database = databases.find((n) => n.label === url.pathname.slice(1))!
    const schema = (await limited.listChildren(database)).find((n) => n.label === 'shop')!
    return limited.listChildren(schema)
  }

  it('opens data with the readable columns only and says how many are hidden', async () => {
    const customers = (await relations()).find((n) => n.label === 'customers')!
    expect(customers.previewQuery).toBe('SELECT "id", "email" FROM "shop"."customers"')
    expect(customers.previewNotice).toBe('2 columns hidden: no SELECT privilege.')

    const [denied] = await run(limited, 'SELECT * FROM "shop"."customers"')
    expect(denied).toMatchObject({ kind: 'error', code: '42501' })
    const [outcome] = await run(limited, customers.previewQuery!)
    expect(outcome?.kind).toBe('rows')
    if (outcome?.kind === 'rows')
      expect(outcome.columns.map((c) => c.name)).toEqual(['id', 'email'])
  })

  it('says so when the role may read no column at all', async () => {
    const orders = (await relations()).find((n) => n.label === 'orders')!
    expect(orders.previewQuery).toBeUndefined()
    expect(orders.previewNotice).toBe(
      'No readable columns: your role has no SELECT privilege on any column of "shop"."orders".',
    )
  })

  it('keeps SELECT * where every column is readable', async () => {
    const own = (
      await reader.listChildren(
        (
          await reader.listChildren(
            (await reader.listChildren()).find((n) => n.label === url.pathname.slice(1)),
          )
        ).find((n) => n.label === 'shop'),
      )
    ).find((n) => n.label === 'customers')!
    expect(own.previewQuery).toBe('SELECT * FROM "shop"."customers"')
    expect(own).not.toHaveProperty('previewNotice')
  })
})

describe('connection strings', () => {
  it('connects with exactly what a pasted URL describes', async () => {
    const parsed = postgresDriver.parseConnectionString!(url.toString())!
    const profile = parseConnectionProfile({
      id: 'test-url',
      name: 'test',
      driver: 'postgres',
      options: parsed.options,
    })
    const options = postgresDriver.parseOptions(profile.options)
    const session = await postgresDriver.connect({
      profile,
      options,
      endpoint: postgresDriver.target(options),
      secrets: parsed.secrets,
      accessMode: 'read-only',
    })
    try {
      const databases = await session.listChildren()
      expect(databases[0]?.label).toBe(url.pathname.slice(1))
    } finally {
      await session.close()
    }
  })
})
