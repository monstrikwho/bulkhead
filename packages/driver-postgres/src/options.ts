import { ConfigError, formatIssues, type OptionField } from '@bulkhead/core'
import { z } from 'zod'

export const SSL_MODES = ['disable', 'require', 'verify-full'] as const
export type SslMode = (typeof SSL_MODES)[number]

const optionsSchema = z.object({
  host: z.string().min(1).default('localhost'),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1).default('postgres'),
  user: z.string().min(1),
  /** `require` encrypts without verifying the certificate; `verify-full` also checks it. */
  ssl: z.enum(SSL_MODES).default('disable'),
  showSystemSchemas: z.boolean().default(false),
})

export type PostgresOptions = z.infer<typeof optionsSchema>

export function parsePostgresOptions(raw: unknown): PostgresOptions {
  const result = optionsSchema.safeParse(raw ?? {})
  if (!result.success) throw new ConfigError(formatIssues(result.error))
  return result.data
}

export const postgresOptionFields: readonly OptionField[] = [
  { key: 'host', label: 'Host', kind: 'string', default: 'localhost', required: true },
  { key: 'port', label: 'Port', kind: 'number', default: 5432, required: true },
  { key: 'user', label: 'User', kind: 'string', required: true },
  {
    key: 'database',
    label: 'Database',
    kind: 'string',
    default: 'postgres',
    required: true,
    description: 'Opened first; the tree lists every database you may connect to.',
  },
  {
    key: 'ssl',
    label: 'SSL',
    kind: 'enum',
    values: SSL_MODES,
    default: 'disable',
    section: 'security',
    description:
      '"require" encrypts the connection; "verify-full" also checks the server certificate and host name.',
  },
  {
    key: 'showSystemSchemas',
    label: 'Show system schemas',
    kind: 'boolean',
    default: false,
    section: 'advanced',
    description: 'pg_catalog, information_schema and pg_toast in the tree.',
  },
]
