import { z } from 'zod'

export const DRIVER_KINDS = ['postgres'] as const
export type DriverKind = (typeof DRIVER_KINDS)[number]

/**
 * Where ssh connects: an alias from `~/.ssh/config`, `host`, `user@host`, `host:port` or
 * `[ipv6]:port`. It ends up on the ssh command line, so nothing that could pass for an option.
 */
const SSH_DESTINATION =
  /^(?:[^@\s-][^@\s]*@)?(?:\[[0-9A-Fa-f:.]+\]|[^@\s:[\]-][^@\s:[\]]*)(?::\d{1,5})?$/

export const sshTransportSchema = z.object({
  kind: z.literal('ssh'),
  host: z
    .string()
    .trim()
    .refine(
      (value) => parseSshDestination(value) !== undefined,
      'SSH host: use a ~/.ssh/config alias or user@host[:port]',
    ),
  /** A private key; empty means what `~/.ssh/config` says. */
  identityFile: z
    .string()
    .trim()
    .refine((value) => !value.startsWith('-'), 'Identity file: not a file path')
    .optional(),
})
export type SshTransportConfig = z.infer<typeof sshTransportSchema>

/**
 * How Bulkhead reaches the database. Delivery is independent of the driver: any driver can sit
 * behind any transport, and the driver's host and port are always the address of the database
 * as seen from the far end of the transport (for SSH: from the SSH server). `kubectl`
 * port-forwarding is planned, see docs/roadmap.md.
 */
export const transportConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct') }),
  sshTransportSchema,
])
export type TransportConfig = z.infer<typeof transportConfigSchema>

/** Splits an SSH destination into its parts; `undefined` for anything the schema refuses. */
export function parseSshDestination(
  destination: string,
): { user?: string; host: string; port?: number } | undefined {
  if (!SSH_DESTINATION.test(destination)) return undefined
  const at = destination.lastIndexOf('@')
  const user = at >= 0 ? destination.slice(0, at) : undefined
  const rest = destination.slice(at + 1)
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(rest)
  if (!match?.[1]) return undefined
  const host = match[1].replace(/^\[|\]$/g, '')
  const port = match[2] === undefined ? undefined : Number(match[2])
  if (port !== undefined && (port < 1 || port > 65535)) return undefined
  return { ...(user === undefined ? {} : { user }), host, ...(port === undefined ? {} : { port }) }
}

/**
 * A saved connection as stored in the `bulkhead.connections` user setting, so Settings Sync
 * carries it between machines. It never contains secrets: those live in VS Code SecretStorage,
 * keyed by `id`.
 */
export const connectionProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  driver: z.enum(DRIVER_KINDS),
  production: z.boolean().default(false),
  readOnly: z.boolean().optional(),
  transport: transportConfigSchema.default({ kind: 'direct' }),
  /** Driver-specific, non-secret settings. Validated by the driver's `parseOptions`. */
  options: z.record(z.string(), z.unknown()).default({}),
})
export type ConnectionProfile = z.infer<typeof connectionProfileSchema>

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export function parseConnectionProfile(raw: unknown): ConnectionProfile {
  const result = connectionProfileSchema.safeParse(raw)
  if (!result.success) throw new ConfigError(formatIssues(result.error))
  return result.data
}

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ')
}
