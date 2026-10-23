import {
  checkReadOnly,
  splitStatements,
  type AccessMode,
  type CellValue,
  type ConnectRequest,
  type DriverSession,
  type ExecuteOptions,
  type ExplorerNode,
  type ResultColumn,
  type StatementOutcome,
} from '@bulkhead/core'
import pg from 'pg'
import Cursor from 'pg-cursor'

import { listChildren } from './explorer'
import type { PostgresOptions } from './options'

/** SQLSTATE 25006: the server refused a write inside a read-only transaction. */
const READ_ONLY_SQL_TRANSACTION = '25006'
const BOOL_OID = 16
const SMALL_INT_OIDS = new Set([21, 23, 26])

/**
 * Values come back as the server prints them, so the grid shows exactly what the database holds:
 * no time-zone shifts for timestamps, no precision loss for bigint and numeric. Only booleans and
 * integers that always fit into a JS number are converted.
 */
const TEXT_TYPES = {
  getTypeParser: (oid: number) => {
    if (oid === BOOL_OID) return (value: string) => value === 't'
    if (SMALL_INT_OIDS.has(oid)) return Number
    return (value: string) => value
  },
} satisfies pg.CustomTypesConfig

type Purpose = 'meta' | 'query'

/**
 * One connection per (purpose, database): `query` connections are sticky so a user's
 * `BEGIN … COMMIT` spans several runs; `meta` connections serve the tree and cancellation.
 *
 * Read-only mode is enforced by three independent layers:
 * 1. `checkReadOnly` refuses anything that is not a plain read before it is sent;
 * 2. every statement runs alone (extended protocol, so no piggy-backed `COMMIT; DELETE`)
 *    inside `BEGIN READ ONLY … ROLLBACK`, so even a `SET` cannot outlive it;
 * 3. the connection starts with `default_transaction_read_only=on`.
 * The access mode is fixed for the session's lifetime: changing it means a new session.
 */
export class PostgresSession implements DriverSession {
  readonly accessMode: AccessMode
  private readonly clients = new Map<string, Promise<pg.Client>>()
  private readonly types = new Map<number, ResultColumn>()
  private closed = false

  constructor(private readonly request: ConnectRequest<PostgresOptions>) {
    this.accessMode = request.accessMode
  }

  /** Opens the default database once so connection errors surface immediately. */
  async open(): Promise<void> {
    await this.client('meta', this.request.options.database)
  }

  listChildren(parent?: ExplorerNode): Promise<ExplorerNode[]> {
    return listChildren(
      async (database, text, values) => (await this.client('meta', database)).query(text, values),
      this.request.options,
      parent,
    )
  }

  async execute(script: string, options: ExecuteOptions): Promise<StatementOutcome[]> {
    const database = options.database ?? this.request.options.database
    const client = await this.client('query', database)
    // Cancellation is best effort: if it fails, the statement simply runs to completion.
    const onAbort = () => {
      this.cancel(client, database).catch(() => undefined)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const outcomes: StatementOutcome[] = []
    try {
      for (const { text } of splitStatements(script, 'postgres')) {
        if (options.signal?.aborted) break
        const outcome = await this.runStatement(client, database, text, options.maxRows)
        outcomes.push(outcome)
        if (outcome.kind === 'error') break
      }
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
    }
    return outcomes
  }

  async close(): Promise<void> {
    this.closed = true
    const clients = [...this.clients.values()]
    this.clients.clear()
    await Promise.allSettled(clients.map(async (client) => (await client).end()))
  }

  private async runStatement(
    client: pg.Client,
    database: string,
    text: string,
    maxRows: number,
  ): Promise<StatementOutcome> {
    const started = performance.now()
    const elapsed = () => Math.round(performance.now() - started)
    const readOnly = this.accessMode === 'read-only'

    if (readOnly) {
      const verdict = checkReadOnly(text, 'postgres')
      if (!verdict.allowed) {
        return {
          kind: 'error',
          statement: text,
          message: verdict.message!,
          blockedBy: 'guard',
          durationMs: 0,
        }
      }
    }

    try {
      const { rows, result } = readOnly
        ? await this.inReadOnlyTransaction(client, database, () =>
            readCursor(client, text, maxRows),
          )
        : await readCursor(client, text, maxRows)
      if (result.fields.length === 0) {
        return {
          kind: 'command',
          statement: text,
          command: result.command ?? '',
          rowCount: result.rowCount ?? null,
          durationMs: elapsed(),
        }
      }
      return {
        kind: 'rows',
        statement: text,
        columns: await this.describeColumns(database, result.fields),
        rows: rows.slice(0, maxRows),
        truncated: rows.length > maxRows,
        durationMs: elapsed(),
      }
    } catch (error) {
      return toErrorOutcome(error, text, elapsed())
    }
  }

  private async inReadOnlyTransaction<T>(
    client: pg.Client,
    database: string,
    body: () => Promise<T>,
  ): Promise<T> {
    await client.query('BEGIN READ ONLY')
    try {
      return await body()
    } finally {
      try {
        await client.query('ROLLBACK')
      } catch {
        // A connection that cannot roll back is in an unknown state: never reuse it.
        this.discard('query', database)
      }
    }
  }

  private async describeColumns(database: string, fields: pg.FieldDef[]): Promise<ResultColumn[]> {
    const unknown = [...new Set(fields.map((f) => f.dataTypeID))].filter(
      (oid) => !this.types.has(oid),
    )
    if (unknown.length > 0) {
      const meta = await this.client('meta', database)
      const { rows } = await meta.query<{ oid: number; name: string; numeric: boolean }>(
        `select oid::int as oid, format_type(oid, null) as name, typcategory = 'N' as numeric
           from pg_type where oid = any($1)`,
        [unknown],
      )
      for (const { oid, name, numeric } of rows) this.types.set(oid, { name, type: name, numeric })
    }
    return fields.map((f) => {
      const type = this.types.get(f.dataTypeID)
      return { name: f.name, type: type?.type ?? '?', numeric: type?.numeric ?? false }
    })
  }

  private async cancel(client: pg.Client, database: string): Promise<void> {
    const pid = (client as pg.Client & { processID?: number }).processID
    if (pid === undefined) return
    const meta = await this.client('meta', database)
    await meta.query('select pg_cancel_backend($1)', [pid])
  }

  private client(purpose: Purpose, database: string): Promise<pg.Client> {
    if (this.closed) return Promise.reject(new Error('Session is closed'))
    const key = `${purpose}:${database}`
    let client = this.clients.get(key)
    if (!client) {
      client = this.connect(database).then((connected) => {
        connected.on('error', () => this.discard(purpose, database))
        connected.on('end', () => this.discard(purpose, database))
        return connected
      })
      client.catch(() => this.clients.delete(key))
      this.clients.set(key, client)
    }
    return client
  }

  private discard(purpose: Purpose, database: string): void {
    const key = `${purpose}:${database}`
    const client = this.clients.get(key)
    this.clients.delete(key)
    void client?.then((c) => c.end()).catch(() => undefined)
  }

  private async connect(database: string): Promise<pg.Client> {
    const { endpoint, options, secrets } = this.request
    const client = new pg.Client({
      host: endpoint.host,
      port: endpoint.port,
      database,
      user: options.user,
      password: secrets.password,
      ssl: sslConfig(options),
      application_name: 'Bulkhead',
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      types: TEXT_TYPES,
      options: this.accessMode === 'read-only' ? '-c default_transaction_read_only=on' : undefined,
    })
    await client.connect()
    return client
  }
}

function sslConfig(options: PostgresOptions): pg.ClientConfig['ssl'] {
  switch (options.ssl) {
    case 'disable':
      return false
    case 'require':
      return { rejectUnauthorized: false }
    case 'verify-full':
      // The endpoint may be a tunnel on localhost; the certificate belongs to the real host.
      return { rejectUnauthorized: true, servername: options.host }
  }
}

interface CursorRead {
  rows: CellValue[][]
  result: pg.QueryResult
}

/** Fetches at most `maxRows + 1` rows: the extra one only tells us the result was truncated. */
async function readCursor(client: pg.Client, text: string, maxRows: number): Promise<CursorRead> {
  const cursor = client.query(new Cursor(text, undefined, { rowMode: 'array', types: TEXT_TYPES }))
  try {
    return await new Promise<CursorRead>((resolve, reject) => {
      cursor.read(maxRows + 1, (error, rows, result) => {
        if (error) reject(error)
        else resolve({ rows: rows as unknown as CellValue[][], result })
      })
    })
  } finally {
    await cursor.close()
  }
}

function toErrorOutcome(error: unknown, statement: string, durationMs: number): StatementOutcome {
  const code = error instanceof pg.DatabaseError ? error.code : undefined
  const message = error instanceof Error ? error.message : String(error)
  if (code === READ_ONLY_SQL_TRANSACTION) {
    return {
      kind: 'error',
      statement,
      message: `Refused by PostgreSQL in read-only mode: ${message}`,
      code,
      blockedBy: 'database',
      durationMs,
    }
  }
  return { kind: 'error', statement, message, code, durationMs }
}
