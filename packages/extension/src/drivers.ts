import type { Driver, DriverKind } from '@bulkhead/core'
import { postgresDriver } from '@bulkhead/driver-postgres'

/** Every driver the extension ships. Adding a database type starts here. */
export const drivers: ReadonlyMap<DriverKind, Driver> = new Map<DriverKind, Driver>([
  ['postgres', postgresDriver],
])

export function driverFor(kind: DriverKind): Driver {
  const driver = drivers.get(kind)
  if (!driver) throw new Error(`No driver for "${kind}"`)
  return driver
}
