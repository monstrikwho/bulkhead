import type { DriverKind } from './connection'

/**
 * What the "new connection" picker offers. An entry is either a driver or a preset of one: a
 * hosted service that speaks the same protocol, with that service's usual defaults. Presets
 * only fill the form; the saved profile is an ordinary profile of the driver.
 *
 * Entries without a driver are planned and shown disabled, so nobody picks a database that
 * cannot connect yet. List a service here only after the driver has been tried against it.
 */
export interface CatalogEntry {
  id: string
  label: string
  /** `null` while the driver does not exist yet. */
  driver: DriverKind | null
  group: 'popular' | 'hosted' | 'planned'
  /** Option values the form starts with. */
  defaults?: Readonly<Record<string, unknown>>
  /** One line under the title of the form, e.g. where to find the connection string. */
  hint?: string
  /** Extra words for the search box. */
  keywords?: readonly string[]
  /** Host name suffixes of the service, to recognise a pasted connection string. */
  hosts?: readonly string[]
}

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'postgres',
    label: 'PostgreSQL',
    driver: 'postgres',
    group: 'popular',
    keywords: ['postgres', 'pg', 'psql'],
  },
  {
    id: 'supabase',
    label: 'Supabase',
    driver: 'postgres',
    group: 'hosted',
    defaults: { port: 5432, database: 'postgres', user: 'postgres', ssl: 'require' },
    hint: 'Paste the connection string from the Connect dialog of your project.',
    hosts: ['.supabase.co', '.supabase.com'],
    keywords: ['postgres'],
  },
  {
    id: 'neon',
    label: 'Neon',
    driver: 'postgres',
    group: 'hosted',
    defaults: { port: 5432, database: 'neondb', ssl: 'verify-full' },
    hint: 'Paste the connection string from the Connect dialog of your project.',
    hosts: ['.neon.tech'],
    keywords: ['postgres', 'serverless'],
  },
  {
    id: 'timescale',
    label: 'TimescaleDB',
    driver: 'postgres',
    group: 'hosted',
    defaults: { database: 'tsdb', user: 'tsdbadmin', ssl: 'require' },
    hosts: ['.tsdb.cloud.timescale.com'],
    keywords: ['postgres', 'tiger', 'time series'],
  },
  {
    id: 'aws-rds',
    label: 'Amazon RDS',
    driver: 'postgres',
    group: 'hosted',
    defaults: { port: 5432, database: 'postgres', ssl: 'require' },
    hosts: ['.rds.amazonaws.com'],
    keywords: ['aws', 'aurora', 'postgres'],
  },
  {
    id: 'cloud-sql',
    label: 'Google Cloud SQL',
    driver: 'postgres',
    group: 'hosted',
    defaults: { port: 5432, database: 'postgres', user: 'postgres', ssl: 'require' },
    keywords: ['gcp', 'google', 'alloydb', 'postgres'],
  },
  {
    id: 'digitalocean',
    label: 'DigitalOcean',
    driver: 'postgres',
    group: 'hosted',
    defaults: { port: 25060, database: 'defaultdb', user: 'doadmin', ssl: 'require' },
    hosts: ['.db.ondigitalocean.com'],
    keywords: ['managed', 'postgres'],
  },
  {
    id: 'render',
    label: 'Render',
    driver: 'postgres',
    group: 'hosted',
    defaults: { port: 5432, ssl: 'require' },
    hosts: ['.render.com'],
    keywords: ['postgres'],
  },
  { id: 'clickhouse', label: 'ClickHouse', driver: null, group: 'planned' },
  { id: 'redis', label: 'Redis', driver: null, group: 'planned', keywords: ['valkey'] },
  { id: 'rabbitmq', label: 'RabbitMQ', driver: null, group: 'planned', keywords: ['amqp'] },
]

/** Entries matching a search; every word must appear in the label, id or keywords. */
export function searchCatalog(query: string, entries = CATALOG): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...entries]
  return entries.filter((entry) => {
    const haystack = [entry.label, entry.id, ...(entry.keywords ?? [])].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** The hosted service a host name belongs to, e.g. Neon for `ep-x.eu-central-1.aws.neon.tech`. */
export function catalogEntryForHost(host: unknown, entries = CATALOG): CatalogEntry | undefined {
  if (typeof host !== 'string' || !host) return undefined
  const name = host.toLowerCase()
  return entries.find((entry) => entry.hosts?.some((suffix) => name.endsWith(suffix)))
}
