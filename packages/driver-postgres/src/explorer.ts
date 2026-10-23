import type { ExplorerNode } from '@bulkhead/core'
import type pg from 'pg'

import type { PostgresOptions } from './options'

type Query = (database: string, text: string, values?: unknown[]) => Promise<pg.QueryResult>

const RELATION_KINDS: Record<string, { kind: string; icon: string }> = {
  r: { kind: 'table', icon: 'table' },
  p: { kind: 'table', icon: 'table' },
  f: { kind: 'foreign-table', icon: 'table' },
  v: { kind: 'view', icon: 'eye' },
  m: { kind: 'materialized-view', icon: 'eye' },
}

/**
 * Builds the tree: database → schema → table/view → (columns | indexes) → items.
 * Every query reads catalogs only, so it works on read-only connections and replicas.
 */
export async function listChildren(
  query: Query,
  options: PostgresOptions,
  parent?: ExplorerNode,
): Promise<ExplorerNode[]> {
  if (!parent) return listDatabases(query, options)
  const database = parent.database ?? options.database
  const ctx = parent.context ?? {}

  switch (parent.kind) {
    case 'database':
      return listSchemas(query, database, options.showSystemSchemas)
    case 'schema':
      return listRelations(query, database, ctx.schema!)
    case 'table':
    case 'foreign-table':
    case 'view':
    case 'materialized-view':
      return relationFolders(parent)
    case 'folder':
      return ctx.folder === 'indexes'
        ? listIndexes(query, database, ctx.oid!, parent.id)
        : listColumns(query, database, ctx.oid!, parent.id)
    default:
      return []
  }
}

export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

async function listDatabases(query: Query, options: PostgresOptions): Promise<ExplorerNode[]> {
  const { rows } = await query(
    options.database,
    `select datname from pg_database
      where not datistemplate and datallowconn and has_database_privilege(datname, 'CONNECT')
      order by datname = current_database() desc, datname`,
  )
  return rows.map(({ datname }: { datname: string }) => ({
    id: `db:${datname}`,
    kind: 'database',
    label: datname,
    icon: 'database',
    expandable: true,
    database: datname,
    qualifiedName: quoteIdentifier(datname),
  }))
}

async function listSchemas(
  query: Query,
  database: string,
  showSystem: boolean,
): Promise<ExplorerNode[]> {
  const { rows } = await query(
    database,
    `select nspname from pg_namespace
      where $1 or (nspname not like 'pg\\_%' and nspname <> 'information_schema')
      order by nspname = current_schema() desc, nspname`,
    [showSystem],
  )
  return rows.map(({ nspname }: { nspname: string }) => ({
    id: `db:${database}/schema:${nspname}`,
    kind: 'schema',
    label: nspname,
    icon: 'symbol-namespace',
    expandable: true,
    database,
    qualifiedName: quoteIdentifier(nspname),
    context: { schema: nspname },
  }))
}

interface RelationRow {
  oid: string
  relname: string
  relkind: string
  estimate: string | null
}

async function listRelations(
  query: Query,
  database: string,
  schema: string,
): Promise<ExplorerNode[]> {
  const { rows } = await query(
    database,
    `select c.oid::text as oid, c.relname, c.relkind,
            case when c.relkind in ('r', 'p', 'm', 'f') and c.reltuples >= 0
                 then c.reltuples::bigint::text end as estimate
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p', 'f', 'v', 'm') and not c.relispartition
      order by c.relkind in ('v', 'm'), c.relname`,
    [schema],
  )
  return (rows as RelationRow[]).map((row) => {
    const { kind, icon } = RELATION_KINDS[row.relkind] ?? { kind: 'table', icon: 'table' }
    const qualifiedName = `${quoteIdentifier(schema)}.${quoteIdentifier(row.relname)}`
    return {
      id: `db:${database}/rel:${row.oid}`,
      kind,
      label: row.relname,
      description:
        row.estimate === null ? undefined : `≈ ${formatCount(Number(row.estimate))} rows`,
      tooltip: row.estimate === null ? kind : `${kind} · estimated rows from pg_class.reltuples`,
      icon,
      expandable: true,
      database,
      qualifiedName,
      previewQuery: `SELECT * FROM ${qualifiedName}`,
      context: { schema, oid: row.oid },
    }
  })
}

function relationFolders(relation: ExplorerNode): ExplorerNode[] {
  const folders: ExplorerNode[] = [folder(relation, 'columns', 'Columns', 'symbol-field')]
  if (relation.kind !== 'view') folders.push(folder(relation, 'indexes', 'Indexes', 'list-tree'))
  return folders
}

function folder(relation: ExplorerNode, key: string, label: string, icon: string): ExplorerNode {
  return {
    id: `${relation.id}/${key}`,
    kind: 'folder',
    label,
    icon,
    expandable: true,
    database: relation.database,
    context: { ...relation.context, folder: key },
  }
}

interface ColumnRow {
  attname: string
  type: string
  notnull: boolean
  primary: boolean
  default: string | null
}

async function listColumns(
  query: Query,
  database: string,
  oid: string,
  parentId: string,
): Promise<ExplorerNode[]> {
  const { rows } = await query(
    database,
    `select a.attname, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
            coalesce(i.indisprimary, false) as primary,
            pg_get_expr(d.adbin, d.adrelid) as default
       from pg_attribute a
       left join pg_index i on i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey)
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = $1::oid and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [oid],
  )
  return (rows as ColumnRow[]).map((row) => ({
    id: `${parentId}/${row.attname}`,
    kind: 'column',
    label: row.attname,
    description: [row.type, row.notnull ? 'not null' : null].filter(Boolean).join(' · '),
    tooltip: row.default === null ? row.type : `${row.type}\ndefault ${row.default}`,
    icon: row.primary ? 'key' : 'symbol-field',
    expandable: false,
    database,
    qualifiedName: quoteIdentifier(row.attname),
  }))
}

interface IndexRow {
  name: string
  definition: string
  primary: boolean
  unique: boolean
}

async function listIndexes(
  query: Query,
  database: string,
  oid: string,
  parentId: string,
): Promise<ExplorerNode[]> {
  const { rows } = await query(
    database,
    `select c.relname as name, pg_get_indexdef(i.indexrelid) as definition,
            i.indisprimary as primary, i.indisunique as unique
       from pg_index i
       join pg_class c on c.oid = i.indexrelid
      where i.indrelid = $1::oid
      order by i.indisprimary desc, c.relname`,
    [oid],
  )
  return (rows as IndexRow[]).map((row) => ({
    id: `${parentId}/${row.name}`,
    kind: 'index',
    label: row.name,
    description: row.primary ? 'primary key' : row.unique ? 'unique' : undefined,
    tooltip: row.definition,
    icon: row.primary ? 'key' : 'list-tree',
    expandable: false,
    database,
    qualifiedName: quoteIdentifier(row.name),
  }))
}

function formatCount(count: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    count,
  )
}
