import { z } from 'zod'

export const DRIVER_KINDS = ['postgres'] as const
export type DriverKind = (typeof DRIVER_KINDS)[number]

/**
 * How Bulkhead reaches the database. Delivery is independent of the driver: any driver can sit
 * behind any transport. `ssh` and `kubectl` port-forwarding are planned, see docs/roadmap.md.
 */
export const transportConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct') }),
])
export type TransportConfig = z.infer<typeof transportConfigSchema>

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
