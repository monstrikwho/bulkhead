import { z } from 'zod'

import { catalogEntryForHost } from './catalog'
import { ConfigError, DRIVER_KINDS } from './connection'
import type { ConnectionDraft, DriverDescriptor } from './connectionForm'
import type { OptionField, ParsedConnectionString } from './driver'

/**
 * What an AI agent may ask for over MCP: a connection to put into the connection form, to test
 * or to save (ADR 0007). Whatever the tool, the values go through the same checks as the form.
 */
export const connectionProposalSchema = z.object({
  connectionId: z
    .string()
    .min(1)
    .optional()
    .describe('Id of a saved connection to edit (from list_connections). Omit for a new one.'),
  driver: z
    .enum(DRIVER_KINDS)
    .optional()
    .describe('Database type of a new connection. Defaults to postgres.'),
  connectionString: z
    .string()
    .min(1)
    .optional()
    .describe(
      'A connection URL such as postgres://user:password@host:5432/db?sslmode=require. A ' +
        'password in it is used like one passed in secrets.',
    ),
  secrets: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Passwords and keys by field, e.g. {"password": "..."}; they win over the connection ' +
        'string. Stored only in VS Code SecretStorage and never returned. Omit to keep the ' +
        'saved ones of an existing connection.',
    ),
  name: z.string().optional().describe('Display name, e.g. "orders (staging)".'),
  environment: z
    .enum(['development', 'production'])
    .optional()
    .describe('production: read-only until the user unlocks writes, highlighted in red.'),
  readOnly: z
    .boolean()
    .optional()
    .describe('Refuse writes on a development connection too. Production is always read-only.'),
  options: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Driver settings; they win over the connection string. See the tool description.'),
})
export type ConnectionProposal = z.infer<typeof connectionProposalSchema>

/** A draft for the form plus what the user should look at before saving. */
export interface ProposedDraft {
  draft: ConnectionDraft
  /** Labels of the fields the agent changed on an existing connection. */
  changed: string[]
  /** Changes that weaken protection, shown prominently. */
  warnings: string[]
}

interface ProposeInput {
  proposal: ConnectionProposal
  driver: DriverDescriptor
  /** The saved connection being edited, as a form draft. */
  existing?: ConnectionDraft
  /** `proposal.connectionString` as read by the driver. */
  parsed?: ParsedConnectionString
}

export function proposeDraft({ proposal, driver, existing, parsed }: ProposeInput): ProposedDraft {
  const options = checkOptions(driver, proposal.options ?? {})
  const secrets = checkSecrets(driver, proposal.secrets ?? {})
  const base: ConnectionDraft = existing ?? {
    name: '',
    driver: driver.kind,
    production: false,
    readOnly: false,
    options: {},
    secrets: {},
  }
  const merged = { ...base.options, ...parsed?.options, ...options }
  const defaults = existing
    ? {}
    : {
        ...fieldDefaults(driver.optionFields),
        ...catalogEntryForHost(merged.host)?.defaults,
      }
  const production = proposal.environment ? proposal.environment === 'production' : base.production
  const draft: ConnectionDraft = {
    ...(base.id === undefined ? {} : { id: base.id }),
    name: proposal.name?.trim() || base.name,
    driver: driver.kind,
    production,
    readOnly: production || (proposal.readOnly ?? base.readOnly),
    options: { ...defaults, ...merged },
    secrets: { ...parsed?.secrets, ...secrets },
  }

  const changed: string[] = []
  const warnings: string[] = []
  if (existing) {
    // Production is read-only whatever the flag says; compare what the user actually gets.
    const wasReadOnly = existing.production || existing.readOnly
    if (draft.name !== existing.name) changed.push('Name')
    if (draft.production !== existing.production) changed.push('Environment')
    if (draft.readOnly !== wasReadOnly) changed.push('Read-only')
    for (const field of driver.optionFields) {
      if (!sameValue(draft.options[field.key], existing.options[field.key])) {
        changed.push(field.label)
      }
    }
    for (const field of driver.secretFields) {
      if (draft.secrets[field.key]) changed.push(field.label)
    }
    if (existing.production && !draft.production) {
      warnings.push('Turns off Production: writes will no longer be blocked.')
    } else if (wasReadOnly && !draft.readOnly) {
      warnings.push('Turns off Read-only: writes will be allowed.')
    }
  }
  return { draft, changed, warnings }
}

/** Option values with the types the form expects; unknown keys and bad values are refused. */
function checkOptions(
  driver: DriverDescriptor,
  raw: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const checked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const field = driver.optionFields.find((candidate) => candidate.key === key)
    if (!field) {
      const known = driver.optionFields.map((candidate) => candidate.key).join(', ')
      throw new ConfigError(`${driver.displayName} has no option "${key}". Known: ${known}.`)
    }
    checked[key] = checkValue(field, value)
  }
  return checked
}

function checkSecrets(
  driver: DriverDescriptor,
  raw: Readonly<Record<string, string>>,
): Record<string, string> {
  for (const key of Object.keys(raw)) {
    if (!driver.secretFields.some((field) => field.key === key)) {
      const known = driver.secretFields.map((field) => field.key).join(', ') || 'none'
      throw new ConfigError(`${driver.displayName} has no secret "${key}". Known: ${known}.`)
    }
  }
  return { ...raw }
}

function checkValue(field: OptionField, value: unknown): unknown {
  const refuse = (expected: string) =>
    new ConfigError(`Option "${field.key}" must be ${expected}, got ${JSON.stringify(value)}.`)
  switch (field.kind) {
    case 'string':
      if (typeof value !== 'string') throw refuse('a string')
      return value
    case 'number': {
      const number = typeof value === 'string' && value.trim() ? Number(value) : value
      if (typeof number !== 'number' || !Number.isFinite(number)) throw refuse('a number')
      return number
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw refuse('true or false')
      return value
    case 'enum':
      if (typeof value !== 'string' || !field.values.includes(value)) {
        throw refuse(`one of ${field.values.join(', ')}`)
      }
      return value
  }
}

function fieldDefaults(fields: readonly OptionField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) => (field.default === undefined ? [] : [[field.key, field.default]])),
  )
}

/** Settings may hold `"5432"` where the form has `5432`. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number'
  return scalar(a) && scalar(b) && String(a) === String(b)
}

/** One line per driver with its options and secrets, for the tool descriptions. */
export function describeDriverOptions(drivers: readonly DriverDescriptor[]): string {
  return drivers
    .map((driver) => {
      const options = driver.optionFields.map((field) => {
        const type = field.kind === 'enum' ? field.values.join('|') : field.kind
        const fallback = field.default === undefined ? '' : `, default ${String(field.default)}`
        return `${field.key} (${type}${fallback})`
      })
      const secrets = driver.secretFields.map((field) => field.key)
      const line = `${driver.kind}: ${options.join(', ')}`
      return secrets.length ? `${line}; secrets: ${secrets.join(', ')}` : line
    })
    .join('\n')
}
