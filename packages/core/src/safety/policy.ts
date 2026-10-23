import type { SqlDialect } from '../sql/lexer'
import { classifyStatement, type Classification } from './classify'

/**
 * How a session may touch the database. `read-only` is enforced in layers: the client-side
 * classifier below, then the driver (read-only transactions, session settings), then whatever
 * the database role allows. Each layer must hold on its own.
 */
export type AccessMode = 'read-only' | 'read-write'

export interface AccessPolicySource {
  /** Production connections start read-only and are highlighted everywhere. */
  production: boolean
  /** Non-production connection that should also start read-only. */
  readOnly?: boolean | undefined
}

export function initialAccessMode(source: AccessPolicySource): AccessMode {
  return source.production || source.readOnly ? 'read-only' : 'read-write'
}

export interface ReadOnlyVerdict {
  allowed: boolean
  classification: Classification
  /** Human-readable refusal, set when `allowed` is false. */
  message?: string
}

export function checkReadOnly(statement: string, dialect: SqlDialect): ReadOnlyVerdict {
  const classification = classifyStatement(statement, dialect)
  if (classification.category === 'read') return { allowed: true, classification }

  const what = classification.reason
    ? `${classification.keyword} (${classification.reason})`
    : classification.keyword
  const why: Record<Exclude<typeof classification.category, 'read'>, string> = {
    write: 'only read statements are allowed',
    session: 'session settings cannot be changed',
    transaction: 'transaction control is managed by Bulkhead',
  }
  return {
    allowed: false,
    classification,
    message: `Blocked by read-only mode: ${what} — ${why[classification.category]}.`,
  }
}
