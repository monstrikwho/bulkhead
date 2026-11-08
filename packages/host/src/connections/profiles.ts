import { ConfigError, parseConnectionProfile } from '@bulkhead/core'

import type { InvalidProfile, ProfileList } from '../ports'

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
