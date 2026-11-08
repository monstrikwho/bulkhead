import { ConfigError, parseConnectionProfile, type ConnectionProfile } from '@bulkhead/core'

import { driverFor } from '../drivers'
import type { InvalidProfile, ProfileList } from '../ports'

/** Where a connection points, for trees and agents: `app@db:5432/app via ssh bastion`. */
export function describeConnection(profile: ConnectionProfile): string {
  const driver = driverFor(profile.driver)
  const target = driver.describe(driver.parseOptions(profile.options))
  return profile.transport.kind === 'ssh' ? `${target} via ssh ${profile.transport.host}` : target
}

/**
 * Validates stored profile entries one by one, so one broken entry (hand-edited, or written by a
 * newer version) does not hide the others. A `ProfileStore` lists through this.
 */
export function readProfiles(raw: readonly unknown[]): ProfileList {
  const profiles: ProfileList['profiles'] = []
  const invalid: InvalidProfile[] = []
  raw.forEach((entry, index) => {
    try {
      profiles.push(parseConnectionProfile(entry))
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error
      const name = (entry as { name?: unknown } | null)?.name
      invalid.push({
        index,
        name: typeof name === 'string' ? name : `#${index + 1}`,
        message: error.message,
      })
    }
  })
  return { profiles, invalid }
}
