import type { JsonValue } from './orcaApi'

/**
 * Plain JSON for Orca. Its panel bridge refuses anything that is not strictly JSON, and an
 * object key holding `undefined` (an optional field the driver left unset) fails the whole
 * reply. A JSON round trip drops such keys, turns `undefined` in arrays into `null` and
 * `undefined` itself into `null`, which is what the panel would have read anyway.
 */
export function toJson(value: unknown): JsonValue {
  const text = JSON.stringify(value)
  return text === undefined ? null : (JSON.parse(text) as JsonValue)
}
