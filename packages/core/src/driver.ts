import type { ConnectionProfile, DriverKind } from './connection'
import type { AccessMode } from './safety/policy'
import type { SqlDialect } from './sql/lexer'
import type { Endpoint } from './transport'

/** A setting shown in the connection form. The driver's `parseOptions` has the final say. */
export type OptionField = {
  key: string
  label: string
  required?: boolean
  placeholder?: string
  description?: string
  /** Where the form shows it; `connection` by default. */
  section?: 'connection' | 'security' | 'advanced'
} & (
  | { kind: 'string'; default?: string }
  | { kind: 'number'; default?: number }
  | { kind: 'boolean'; default?: boolean }
  | { kind: 'enum'; values: readonly string[]; default?: string }
)

export interface SecretField {
  key: string
  label: string
  optional?: boolean
}

/** What a pasted connection string (URL, JDBC URL, …) says about a connection. */
export interface ParsedConnectionString {
  options: Record<string, unknown>
  secrets: Record<string, string>
}

/**
 * A node in the connection tree below the connection itself. The driver decides the shape:
 * databases and schemas for SQL, key prefixes for Redis, vhosts and queues for RabbitMQ.
 */
export interface ExplorerNode {
  /** Unique within the connection; stable across refreshes. */
  id: string
  /** Driver-defined, e.g. `database`, `table`, `column`. Used for menus and icons. */
  kind: string
  label: string
  description?: string
  tooltip?: string
  /** Codicon id, e.g. `table`. */
  icon?: string
  expandable: boolean
  /** Database the node belongs to, for drivers with several databases per connection. */
  database?: string
  /** Fully qualified name to copy or insert into the editor. */
  qualifiedName?: string
  /** Query that shows the node's data, e.g. `SELECT * FROM "public"."users"`. */
  previewQuery?: string
  /** Driver-private data needed to list children. */
  context?: Readonly<Record<string, string>>
}

export type CellValue = string | number | boolean | null

export interface ResultColumn {
  name: string
  type: string
  /** Numeric type, even when its values arrive as text to keep precision. Right-aligned. */
  numeric?: boolean
}

interface OutcomeBase {
  statement: string
  durationMs: number
}

export type StatementOutcome =
  | (OutcomeBase & {
      kind: 'rows'
      columns: ResultColumn[]
      rows: CellValue[][]
      /** More rows exist than `maxRows`; only the first `maxRows` were fetched. */
      truncated: boolean
    })
  | (OutcomeBase & { kind: 'command'; command: string; rowCount: number | null })
  | (OutcomeBase & {
      kind: 'error'
      message: string
      code?: string
      /**
       * Set when read-only mode stopped the statement: `guard` is the client-side check,
       * `database` means the server refused the write.
       */
      blockedBy?: 'guard' | 'database'
    })

/** The part of `AbortSignal` drivers use; core stays free of DOM and Node typings. */
export interface CancelSignal {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

export interface ExecuteOptions {
  maxRows: number
  database?: string | undefined
  signal?: CancelSignal
}

export interface DriverSession {
  readonly accessMode: AccessMode
  /** Children of `parent`, or top-level nodes when `parent` is omitted. */
  listChildren(parent?: ExplorerNode): Promise<ExplorerNode[]>
  /** Runs a script statement by statement and stops at the first error. */
  execute(script: string, options: ExecuteOptions): Promise<StatementOutcome[]>
  close(): Promise<void>
}

export interface ConnectRequest<Options> {
  profile: ConnectionProfile
  options: Options
  /** Where to connect: the transport's local end, not necessarily the configured host. */
  endpoint: Endpoint
  secrets: Readonly<Record<string, string | undefined>>
  accessMode: AccessMode
}

export interface Driver<Options = unknown> {
  readonly kind: DriverKind
  readonly displayName: string
  /** SQL dialect for statement splitting and read-only checks; `null` for non-SQL drivers. */
  readonly dialect: SqlDialect | null
  readonly optionFields: readonly OptionField[]
  readonly secretFields: readonly SecretField[]
  /** Validates raw options from settings; throws `ConfigError`. */
  parseOptions(raw: unknown): Options
  /** The address the transport must reach. */
  target(options: Options): Endpoint
  /** Short summary for the tree, e.g. `app@db.internal:5432/app`. */
  describe(options: Options): string
  /**
   * Reads a connection string the user pasted; `undefined` if it is not one of this driver's.
   * Throws `ConfigError` when it is this driver's but malformed.
   */
  parseConnectionString?(text: string): ParsedConnectionString | undefined
  connect(request: ConnectRequest<Options>): Promise<DriverSession>
}
