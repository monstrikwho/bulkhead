import type { ConnectionProfile } from '@bulkhead/core'

import type { HostUi } from '../ports'
import type { ConnectionManager } from './manager'

/**
 * **Unlock Writes…**: reconnects read-write only after the user confirms through the host. Every
 * host goes through here, so none can unlock without the confirmation.
 */
export async function unlockWrites(
  manager: ConnectionManager,
  ui: HostUi,
  profile: ConnectionProfile,
): Promise<boolean> {
  if (!(await ui.confirmUnlock(profile))) return false
  await manager.setAccessMode(profile, 'read-write')
  return true
}
