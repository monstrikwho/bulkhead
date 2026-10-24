import { randomUUID } from 'node:crypto'

import {
  ConfigError,
  connectionDraftSchema,
  formatIssues,
  parseConnectionProfile,
  type ConnectionDraft,
  type ConnectionProfile,
} from '@bulkhead/core'
import * as vscode from 'vscode'

import { driverFor } from '../drivers'
import type { ConnectionManager } from './manager'
import type { SecretVault } from './secrets'
import type { ConnectionStore } from './store'

/**
 * Testing and saving a connection draft. The connection form and the MCP tools both come here,
 * so a draft from an agent passes exactly the checks of one typed by hand.
 */
export interface DraftDependencies {
  store: ConnectionStore
  secrets: SecretVault
  manager: ConnectionManager
}

export type TestResult =
  { ok: true; durationMs: number; databases: string[] } | { ok: false; message: string }

export function parseDraft(raw: unknown): ConnectionDraft {
  const result = connectionDraftSchema.safeParse(raw)
  if (!result.success) throw new ConfigError(formatIssues(result.error))
  return result.data
}

/** A throwaway read-only session that lists the databases; never throws. */
export async function testDraft(
  deps: DraftDependencies,
  raw: unknown,
  existing: ConnectionProfile | undefined,
): Promise<TestResult> {
  try {
    const draft = parseDraft(raw)
    const profile = toProfile(draft, { requireName: false })
    const secrets = await secretsFor(deps.secrets, draft, profile, existing)
    return { ok: true, ...(await deps.manager.probe(profile, secrets)) }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

/** Validates and stores the draft: profile in settings, secrets in SecretStorage. */
export async function saveDraft(
  deps: DraftDependencies,
  draft: ConnectionDraft,
  existing: ConnectionProfile | undefined,
): Promise<ConnectionProfile> {
  const profile = toProfile(draft, { requireName: true })
  for (const field of driverFor(profile.driver).secretFields) {
    const typed = draft.secrets[field.key] ?? ''
    // Editing: empty keeps the saved value. New: empty is stored, meaning "no password".
    if (typed !== '' || !existing) await deps.secrets.set(profile.id, field.key, typed)
  }
  if (existing) await deps.manager.disconnect(profile.id)
  await deps.store.save(profile)
  return profile
}

/** Builds and validates the profile the draft describes; throws `ConfigError`. */
function toProfile(
  draft: ConnectionDraft,
  { requireName }: { requireName: boolean },
): ConnectionProfile {
  const name = draft.name.trim()
  if (requireName && !name) throw new ConfigError(vscode.l10n.t('Give the connection a name.'))
  const driver = driverFor(draft.driver)
  // Empty fields mean "use the driver's default".
  const options = Object.fromEntries(
    Object.entries(draft.options)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value] as const)
      .filter(([, value]) => value !== '' && value !== undefined && value !== null),
  )
  driver.parseOptions(options)
  return parseConnectionProfile({
    id: draft.id ?? randomUUID(),
    name: name || driver.displayName,
    driver: draft.driver,
    production: draft.production,
    // Production is always read-only at first; the flag only matters for other connections.
    ...(draft.readOnly && !draft.production ? { readOnly: true } : {}),
    options,
  })
}

/** Typed secrets win; when editing, empty fields fall back to the saved ones. */
async function secretsFor(
  vault: SecretVault,
  draft: ConnectionDraft,
  profile: ConnectionProfile,
  existing: ConnectionProfile | undefined,
): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {}
  for (const field of driverFor(profile.driver).secretFields) {
    const value =
      draft.secrets[field.key] || (existing ? await vault.get(profile.id, field.key) : undefined)
    if (value) secrets[field.key] = value
  }
  return secrets
}

/**
 * A readable one-liner. Node reports a refused `localhost` as an `AggregateError` with an empty
 * message (one attempt per address, IPv6 and IPv4), so its inner errors are spelled out.
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) {
    const inner = [...new Set(error.errors.map((item: unknown) => describeError(item)))]
    return inner.join('; ')
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    if (error.message) return error.message
    if (typeof code === 'string') return code
    return error.name
  }
  return String(error)
}
