import type { AccessMode, ConnectionProfile } from '@bulkhead/core'
import { describe, expect, it } from 'vitest'

import { RecordingUi } from '../testing'
import { unlockWrites } from './access'
import type { ConnectionManager } from './manager'

const profile: ConnectionProfile = {
  id: 'p',
  name: 'orders-prod',
  driver: 'postgres',
  production: true,
  transport: { kind: 'direct' },
  options: {},
}

function fakeManager() {
  const modes: AccessMode[] = []
  const manager = {
    setAccessMode: (_: ConnectionProfile, mode: AccessMode) => {
      modes.push(mode)
      return Promise.resolve()
    },
  } as unknown as ConnectionManager
  return { manager, modes }
}

describe('unlockWrites', () => {
  it('does not touch the session unless the user confirms', async () => {
    const { manager, modes } = fakeManager()
    const ui = new RecordingUi()
    expect(await unlockWrites(manager, ui, profile)).toBe(false)
    expect(modes).toEqual([])
  })

  it('reconnects read-write once confirmed', async () => {
    const { manager, modes } = fakeManager()
    const ui = new RecordingUi()
    ui.unlock = true
    expect(await unlockWrites(manager, ui, profile)).toBe(true)
    expect(modes).toEqual(['read-write'])
  })
})
